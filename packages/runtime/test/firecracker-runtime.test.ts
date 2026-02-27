import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createFirecrackerRuntime } from "../src/firecracker-runtime.ts";

function createMockExec(responses?: Map<string, string>) {
	const calls: Array<{ bin: string; args: string[] }> = [];

	async function exec(bin: string, args: string[]): Promise<string> {
		calls.push({ bin, args });
		if (!responses) {
			return "";
		}
		const key = [bin, ...args].join(" ");
		const response = responses.get(key);
		if (response !== undefined) {
			return response;
		}
		return "";
	}

	return { exec, calls };
}

describe("FirecrackerRuntime", () => {
	let tempDir: string;
	let basePath: string;
	let baseImageDir: string;
	let vmDir: string;
	let kernelPath: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "fc-runtime-test-"));
		basePath = join(tempDir, ".firecracker");
		baseImageDir = join(basePath, "base");
		vmDir = join(basePath, "vms");
		kernelPath = join(basePath, "kernel", "vmlinux");

		mkdirSync(baseImageDir, { recursive: true });
		mkdirSync(vmDir, { recursive: true });
		mkdirSync(join(basePath, "kernel"), { recursive: true });
		writeFileSync(kernelPath, "fake-kernel");
		writeFileSync(join(baseImageDir, "rockpool-workspace.ext4"), "fake-rootfs");
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("create copies rootfs with reflink and writes vm.json", async () => {
		const { exec, calls } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.create("workspace-abc", "rockpool-workspace");

		const vmPath = join(vmDir, "workspace-abc");
		assert.ok(existsSync(vmPath), "VM directory should exist");
		assert.ok(existsSync(join(vmPath, "vm.json")), "vm.json should exist");

		const cpCall = calls.find((c) => c.bin === "cp" && c.args.includes("--reflink=auto"));
		assert.ok(cpCall, "should copy rootfs with --reflink=auto");
		assert.ok(cpCall.args.includes(join(baseImageDir, "rockpool-workspace.ext4")));
		assert.ok(cpCall.args.includes(join(vmPath, "rootfs.ext4")));

		const config = JSON.parse(readFileSync(join(vmPath, "vm.json"), "utf-8"));
		assert.equal(config["boot-source"].kernel_image_path, kernelPath);
		assert.ok(config["boot-source"].boot_args.includes("rockpool.ip=172.16.0.2"));
		assert.ok(config["boot-source"].boot_args.includes("rockpool.gw=172.16.0.1"));
		assert.ok(config["boot-source"].boot_args.includes("rockpool.mask=16"));
		assert.equal(config.drives[0].drive_id, "rootfs");
		assert.equal(config.drives[0].is_root_device, true);
		assert.equal(config.drives[0].is_read_only, false);
		assert.equal(config["machine-config"].vcpu_count, 2);
		assert.equal(config["machine-config"].mem_size_mib, 4096);
		assert.equal(config["network-interfaces"][0].iface_id, "eth0");
		assert.equal(config["network-interfaces"][0].guest_mac, "06:00:AC:10:00:02");
		assert.equal(config["network-interfaces"][0].host_dev_name, "rp-tap0");
		assert.equal(config.balloon.amount_mib, 0);
		assert.equal(config.balloon.deflate_on_oom, true);
		assert.equal(config.balloon.stats_polling_interval_s, 5);
	});

	it("create calls net script to create TAP device", async () => {
		const { exec, calls } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			netScriptPath: "/usr/local/bin/firecracker-net.sh",
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.create("workspace-abc", "rockpool-workspace");

		const tapCall = calls.find(
			(c) => c.bin === "sudo" && c.args.includes("create") && c.args.includes("rp-tap0"),
		);
		assert.ok(tapCall, "should call sudo with net script to create TAP");
		assert.deepEqual(tapCall.args, [
			"-n",
			"/usr/local/bin/firecracker-net.sh",
			"create",
			"rp-tap0",
			"rockpool0",
		]);
	});

	it("create allocates unique slots for multiple VMs", async () => {
		const { exec } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.create("workspace-a", "rockpool-workspace");
		await runtime.create("workspace-b", "rockpool-workspace");

		const configA = JSON.parse(readFileSync(join(vmDir, "workspace-a", "vm.json"), "utf-8"));
		const configB = JSON.parse(readFileSync(join(vmDir, "workspace-b", "vm.json"), "utf-8"));

		assert.ok(configA["boot-source"].boot_args.includes("rockpool.ip=172.16.0.2"));
		assert.ok(configB["boot-source"].boot_args.includes("rockpool.ip=172.16.0.3"));
		assert.equal(configA["network-interfaces"][0].host_dev_name, "rp-tap0");
		assert.equal(configB["network-interfaces"][0].host_dev_name, "rp-tap1");
	});

	it("start spawns firecracker directly and writes PID file from child.pid", async () => {
		const { exec } = createMockExec();
		const spawnCalls: Array<{ bin: string; args: string[] }> = [];

		function mockSpawn(bin: string, args: string[]): number | undefined {
			spawnCalls.push({ bin, args });
			return process.pid;
		}

		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			spawn: mockSpawn,
			pollIntervalMs: 10,
			pollMaxAttempts: 5,
		});

		await runtime.create("workspace-abc", "rockpool-workspace");
		await runtime.start("workspace-abc");

		assert.equal(spawnCalls.length, 1);
		assert.equal(spawnCalls[0].bin, "sudo");

		const firecrackerBin = join(basePath, "bin", "firecracker");
		assert.equal(spawnCalls[0].args[0], "-n");
		assert.equal(spawnCalls[0].args[1], firecrackerBin);
		assert.ok(spawnCalls[0].args.includes("--api-sock"), "should pass --api-sock");
		assert.ok(spawnCalls[0].args.includes("--config-file"), "should pass --config-file");
		assert.ok(spawnCalls[0].args.includes("--log-path"), "should pass --log-path");
		assert.ok(spawnCalls[0].args.includes("--level"), "should pass --level");

		const pidPath = join(vmDir, "workspace-abc", "firecracker.pid");
		const pidContent = readFileSync(pidPath, "utf-8").trim();
		assert.equal(pidContent, String(process.pid), "PID file should contain the child PID");
	});

	it("start cleans up stale socket before spawning", async () => {
		const { exec } = createMockExec();

		function mockSpawn(_bin: string, _args: string[]): number | undefined {
			return process.pid;
		}

		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			spawn: mockSpawn,
			pollIntervalMs: 10,
			pollMaxAttempts: 5,
		});

		await runtime.create("workspace-abc", "rockpool-workspace");

		const vmPath = join(vmDir, "workspace-abc");
		const sockPath = join(vmPath, "firecracker.sock");
		writeFileSync(sockPath, "stale-socket");
		assert.ok(existsSync(sockPath), "stale socket should exist before start");

		await runtime.start("workspace-abc");

		assert.ok(true, "start should not throw even with stale socket");
	});

	it("status returns not_found when VM directory does not exist", async () => {
		const { exec } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		const result = await runtime.status("nonexistent");
		assert.equal(result, "not_found");
	});

	it("status returns stopped when VM directory exists but no PID", async () => {
		const { exec } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.create("workspace-abc", "rockpool-workspace");

		const result = await runtime.status("workspace-abc");
		assert.equal(result, "stopped");
	});

	it("status returns stopped when PID file has invalid content", async () => {
		const { exec } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.create("workspace-abc", "rockpool-workspace");
		writeFileSync(join(vmDir, "workspace-abc", "firecracker.pid"), "not-a-number");

		const result = await runtime.status("workspace-abc");
		assert.equal(result, "stopped");
	});

	it("status returns stopped when PID file points to dead process", async () => {
		const { exec } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.create("workspace-abc", "rockpool-workspace");
		writeFileSync(join(vmDir, "workspace-abc", "firecracker.pid"), "999999999");

		const result = await runtime.status("workspace-abc");
		assert.equal(result, "stopped");
	});

	it("status returns running when PID file points to alive process", async () => {
		const { exec } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.create("workspace-abc", "rockpool-workspace");
		writeFileSync(join(vmDir, "workspace-abc", "firecracker.pid"), String(process.pid));

		const result = await runtime.status("workspace-abc");
		assert.equal(result, "running");
	});

	it("getIp returns the statically assigned IP", async () => {
		const { exec } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.create("workspace-abc", "rockpool-workspace");

		const ip = await runtime.getIp("workspace-abc");
		assert.equal(ip, "172.16.0.2");
	});

	it("getIp returns unique IPs for different VMs", async () => {
		const { exec } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.create("workspace-a", "rockpool-workspace");
		await runtime.create("workspace-b", "rockpool-workspace");

		const ipA = await runtime.getIp("workspace-a");
		const ipB = await runtime.getIp("workspace-b");

		assert.equal(ipA, "172.16.0.2");
		assert.equal(ipB, "172.16.0.3");
		assert.notEqual(ipA, ipB);
	});

	it("getIp throws for non-existent VM", async () => {
		const { exec } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await assert.rejects(() => runtime.getIp("nonexistent"), {
			message: 'Firecracker: no slot allocation for VM "nonexistent"',
		});
	});

	it("stop is a no-op when no PID file exists", async () => {
		const { exec, calls } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.create("workspace-abc", "rockpool-workspace");
		const callsBefore = calls.length;

		await runtime.stop("workspace-abc");

		const killCalls = calls.slice(callsBefore).filter((c) => c.args.includes("kill"));
		assert.equal(killCalls.length, 0, "should not call kill when no PID");
	});

	it("remove destroys TAP and deletes VM directory", async () => {
		const { exec, calls } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			netScriptPath: "/usr/local/bin/firecracker-net.sh",
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.create("workspace-abc", "rockpool-workspace");
		const vmPath = join(vmDir, "workspace-abc");
		assert.ok(existsSync(vmPath), "VM directory should exist before remove");

		await runtime.remove("workspace-abc");

		assert.ok(!existsSync(vmPath), "VM directory should be deleted after remove");

		const destroyCall = calls.find(
			(c) => c.bin === "sudo" && c.args.includes("destroy") && c.args.includes("rp-tap0"),
		);
		assert.ok(destroyCall, "should call sudo with net script to destroy TAP");
	});

	it("remove frees slot for reuse", async () => {
		const { exec } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.create("workspace-a", "rockpool-workspace");
		await runtime.create("workspace-b", "rockpool-workspace");

		const ipA = await runtime.getIp("workspace-a");
		assert.equal(ipA, "172.16.0.2");

		await runtime.remove("workspace-a");

		writeFileSync(join(baseImageDir, "rockpool-workspace.ext4"), "fake-rootfs");
		await runtime.create("workspace-c", "rockpool-workspace");
		const ipC = await runtime.getIp("workspace-c");
		assert.equal(ipC, "172.16.0.2", "released slot should be reused");
	});

	it("remove is safe for non-existent VM", async () => {
		const { exec } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.remove("nonexistent");
	});

	it("create with custom vcpu and memory", async () => {
		const { exec } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			vcpuCount: 4,
			memSizeMib: 8192,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.create("workspace-abc", "rockpool-workspace");

		const config = JSON.parse(readFileSync(join(vmDir, "workspace-abc", "vm.json"), "utf-8"));
		assert.equal(config["machine-config"].vcpu_count, 4);
		assert.equal(config["machine-config"].mem_size_mib, 8192);
	});

	it("configure uses SSH to write config via shared ssh-commands", async () => {
		const calls: Array<{ bin: string; args: string[] }> = [];
		async function exec(bin: string, args: string[]): Promise<string> {
			calls.push({ bin, args });
			return "";
		}

		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			sshKeyPath: "/tmp/test_key",
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.create("workspace-abc", "rockpool-workspace");
		assert.ok(runtime.configure, "configure should be defined");

		await runtime.configure("workspace-abc", {
			ROCKPOOL_WORKSPACE_NAME: "workspace-abc",
		});

		const sshCall = calls.find((c) => c.bin === "ssh");
		assert.ok(sshCall, "should have made an SSH call");
		assert.ok(sshCall.args.includes("-i"));
		assert.ok(sshCall.args.includes("/tmp/test_key"));
		assert.ok(sshCall.args.includes("admin@172.16.0.2"));

		const shellCmd = sshCall.args[sshCall.args.length - 1];
		assert.ok(shellCmd.includes("/workspace/workspace-abc"));
		assert.ok(shellCmd.includes("config.yaml"));
		assert.ok(shellCmd.includes("systemctl restart code-server@admin"));
	});

	it("configure throws when sshKeyPath is not set", async () => {
		const { exec } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.create("workspace-abc", "rockpool-workspace");

		const { configure } = runtime;
		assert.ok(configure, "configure should be defined");
		await assert.rejects(
			() => configure("workspace-abc", { ROCKPOOL_WORKSPACE_NAME: "workspace-abc" }),
			/sshKeyPath is required/,
		);
	});

	it("clone writes credential helper and runs git clone with token", async () => {
		const calls: Array<{ bin: string; args: string[] }> = [];
		async function exec(bin: string, args: string[]): Promise<string> {
			calls.push({ bin, args });
			return "";
		}

		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			sshKeyPath: "/tmp/test_key",
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.create("workspace-abc", "rockpool-workspace");
		assert.ok(runtime.clone, "clone should be defined");

		await runtime.clone("workspace-abc", "172.16.0.2", "octocat/Hello-World", "ghp_testtoken123");

		const sshCalls = calls.filter((c) => c.bin === "ssh");
		assert.ok(
			sshCalls.length >= 3,
			"should have at least 3 SSH calls (ready check, credential helper, git clone)",
		);

		const readyCheck = sshCalls[0].args[sshCalls[0].args.length - 1];
		assert.equal(readyCheck, "true");

		const credentialCmd = sshCalls[1].args[sshCalls[1].args.length - 1];
		assert.ok(credentialCmd.includes(".rockpool/git-credential-helper"));
		assert.ok(credentialCmd.includes("ghp_testtoken123"));

		const cloneCmd =
			sshCalls[sshCalls.length - 1].args[sshCalls[sshCalls.length - 1].args.length - 1];
		assert.ok(cloneCmd.includes("git clone --depth 1 --single-branch"));
		assert.ok(cloneCmd.includes("https://github.com/octocat/Hello-World.git"));
	});

	it("clone throws when sshKeyPath is not set", async () => {
		const { exec } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		const { clone } = runtime;
		assert.ok(clone, "clone should be defined");
		await assert.rejects(
			() => clone("workspace-abc", "172.16.0.2", "octocat/Hello-World"),
			/sshKeyPath is required/,
		);
	});

	it("vm.json contains correct boot args format", async () => {
		const { exec } = createMockExec();
		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.create("workspace-abc", "rockpool-workspace");

		const config = JSON.parse(readFileSync(join(vmDir, "workspace-abc", "vm.json"), "utf-8"));
		const bootArgs = config["boot-source"].boot_args;

		assert.ok(bootArgs.includes("console=ttyS0"));
		assert.ok(bootArgs.includes("reboot=k"));
		assert.ok(bootArgs.includes("panic=1"));
		assert.ok(bootArgs.includes("pci=off"));
		assert.ok(bootArgs.includes("rockpool.ip="));
		assert.ok(bootArgs.includes("rockpool.gw="));
		assert.ok(bootArgs.includes("rockpool.mask="));
	});

	it("slot allocation persists across runtime instances", async () => {
		const { exec: exec1 } = createMockExec();
		const runtime1 = createFirecrackerRuntime({
			basePath,
			exec: exec1,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime1.create("workspace-a", "rockpool-workspace");
		await runtime1.create("workspace-b", "rockpool-workspace");

		const { exec: exec2 } = createMockExec();
		const runtime2 = createFirecrackerRuntime({
			basePath,
			exec: exec2,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		const ipA = await runtime2.getIp("workspace-a");
		const ipB = await runtime2.getIp("workspace-b");

		assert.equal(ipA, "172.16.0.2");
		assert.equal(ipB, "172.16.0.3");
	});

	it("start throws with error details when process exits immediately", async () => {
		const { exec } = createMockExec();

		function mockSpawn(_bin: string, _args: string[]): number | undefined {
			return 999999999;
		}

		const runtime = createFirecrackerRuntime({
			basePath,
			exec,
			spawn: mockSpawn,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime.create("workspace-abc", "rockpool-workspace");
		await assert.rejects(() => runtime.start("workspace-abc"), /process exited/);
	});

	it("cleans up stale slot allocations on construction", async () => {
		const { exec: exec1 } = createMockExec();
		const runtime1 = createFirecrackerRuntime({
			basePath,
			exec: exec1,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await runtime1.create("workspace-stale", "rockpool-workspace");
		writeFileSync(join(vmDir, "workspace-stale", "firecracker.pid"), "999999999");

		await runtime1.create("workspace-alive", "rockpool-workspace");
		writeFileSync(join(vmDir, "workspace-alive", "firecracker.pid"), String(process.pid));

		const { exec: exec2 } = createMockExec();
		const runtime2 = createFirecrackerRuntime({
			basePath,
			exec: exec2,
			pollIntervalMs: 10,
			pollMaxAttempts: 3,
		});

		await assert.rejects(() => runtime2.getIp("workspace-stale"), /no slot allocation/);

		const ipAlive = await runtime2.getIp("workspace-alive");
		assert.equal(ipAlive, "172.16.0.3");
	});
});
