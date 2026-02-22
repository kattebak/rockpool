import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTartRuntime } from "../src/tart-runtime.ts";

function createMockExec(responses: Map<string, string>) {
	const calls: Array<{ bin: string; args: string[] }> = [];

	async function exec(bin: string, args: string[]): Promise<string> {
		calls.push({ bin, args });
		const key = [bin, ...args].join(" ");
		const response = responses.get(key);
		if (response === undefined) {
			throw new Error(`Mock: unexpected call: ${key}`);
		}
		return response;
	}

	return { exec, calls };
}

function createMockSpawn() {
	const calls: Array<{ bin: string; args: string[] }> = [];

	function spawn(bin: string, args: string[]): void {
		calls.push({ bin, args });
	}

	return { spawn, calls };
}

const RUNNING_LIST =
	"Source\tName\tDisk\tSize\tState\tOS\nlocal\tmy-workspace\t20480\t1024\trunning\tlinux";

describe("TartRuntime", () => {
	it("create calls tart clone with image and name", async () => {
		const { exec, calls } = createMockExec(new Map([["tart clone alpine-base my-workspace", ""]]));
		const runtime = createTartRuntime({ exec });

		await runtime.create("my-workspace", "alpine-base");

		assert.equal(calls.length, 1);
		assert.equal(calls[0].bin, "tart");
		assert.deepEqual(calls[0].args, ["clone", "alpine-base", "my-workspace"]);
	});

	it("stop calls tart stop with name", async () => {
		const { exec, calls } = createMockExec(new Map([["tart stop my-workspace", ""]]));
		const runtime = createTartRuntime({ exec });

		await runtime.stop("my-workspace");

		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0].args, ["stop", "my-workspace"]);
	});

	it("remove calls tart delete with name", async () => {
		const { exec, calls } = createMockExec(new Map([["tart delete my-workspace", ""]]));
		const runtime = createTartRuntime({ exec });

		await runtime.remove("my-workspace");

		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0].args, ["delete", "my-workspace"]);
	});

	it("start spawns tart run detached and polls for running status", async () => {
		const { exec } = createMockExec(new Map([["tart list", RUNNING_LIST]]));
		const { spawn, calls: spawnCalls } = createMockSpawn();
		const runtime = createTartRuntime({ exec, spawn });

		await runtime.start("my-workspace");

		assert.equal(spawnCalls.length, 1);
		assert.equal(spawnCalls[0].bin, "tart");
		assert.deepEqual(spawnCalls[0].args, ["run", "my-workspace", "--no-graphics"]);
	});

	it("status returns running when VM is running", async () => {
		const { exec } = createMockExec(new Map([["tart list", RUNNING_LIST]]));
		const runtime = createTartRuntime({ exec });

		const result = await runtime.status("my-workspace");
		assert.equal(result, "running");
	});

	it("status returns stopped when VM is stopped", async () => {
		const tartListOutput =
			"Source\tName\tDisk\tSize\tState\tOS\nlocal\tmy-workspace\t20480\t1024\tstopped\tlinux";
		const { exec } = createMockExec(new Map([["tart list", tartListOutput]]));
		const runtime = createTartRuntime({ exec });

		const result = await runtime.status("my-workspace");
		assert.equal(result, "stopped");
	});

	it("status returns not_found when VM does not exist", async () => {
		const tartListOutput = "Source\tName\tDisk\tSize\tState\tOS";
		const { exec } = createMockExec(new Map([["tart list", tartListOutput]]));
		const runtime = createTartRuntime({ exec });

		const result = await runtime.status("nonexistent");
		assert.equal(result, "not_found");
	});

	it("getIp returns IP on first successful poll", async () => {
		const { exec } = createMockExec(new Map([["tart ip my-workspace", "192.168.64.5"]]));
		const runtime = createTartRuntime({ exec, pollIntervalMs: 10, pollMaxAttempts: 3 });

		const ip = await runtime.getIp("my-workspace");
		assert.equal(ip, "192.168.64.5");
	});

	it("getIp retries on failure and eventually succeeds", async () => {
		let callCount = 0;
		async function exec(_bin: string, args: string[]): Promise<string> {
			if (args[0] === "ip") {
				callCount++;
				if (callCount < 3) {
					throw new Error("not ready");
				}
				return "192.168.64.10";
			}
			throw new Error("unexpected");
		}

		const runtime = createTartRuntime({ exec, pollIntervalMs: 10, pollMaxAttempts: 5 });
		const ip = await runtime.getIp("my-workspace");

		assert.equal(ip, "192.168.64.10");
		assert.equal(callCount, 3);
	});

	it("getIp throws after max attempts", async () => {
		async function exec(): Promise<string> {
			throw new Error("not ready");
		}

		const runtime = createTartRuntime({ exec, pollIntervalMs: 10, pollMaxAttempts: 3 });

		await assert.rejects(() => runtime.getIp("my-workspace"), {
			message: 'Tart: timed out waiting for IP of VM "my-workspace"',
		});
	});

	it("configure uses SSH to write YAML config and restart code-server", async () => {
		const calls: Array<{ bin: string; args: string[] }> = [];
		async function exec(bin: string, args: string[]): Promise<string> {
			calls.push({ bin, args });
			if (bin === "tart" && args[0] === "ip") {
				return "192.168.64.5";
			}
			return "";
		}

		const runtime = createTartRuntime({ exec, sshKeyPath: "/tmp/test_key" });

		assert.ok(runtime.configure, "configure should be defined");
		await runtime.configure("my-workspace", {
			TIDEPOOL_WORKSPACE_NAME: "my-workspace",
		});

		assert.equal(calls.length, 2);
		assert.equal(calls[0].bin, "tart");
		assert.deepEqual(calls[0].args, ["ip", "my-workspace"]);

		assert.equal(calls[1].bin, "ssh");
		assert.ok(calls[1].args.includes("-i"));
		assert.ok(calls[1].args.includes("/tmp/test_key"));
		assert.ok(calls[1].args.includes("admin@192.168.64.5"));

		const shellCmd = calls[1].args[calls[1].args.length - 1];
		assert.ok(shellCmd.includes("/workspace/my-workspace"));
		assert.ok(shellCmd.includes("config.yaml"));
		assert.ok(shellCmd.includes("systemctl restart code-server@admin"));
	});

	it("configure retries when SSH is not ready", async () => {
		let sshCallCount = 0;
		async function exec(bin: string, args: string[]): Promise<string> {
			if (bin === "tart" && args[0] === "ip") {
				return "192.168.64.5";
			}
			if (bin === "ssh") {
				sshCallCount++;
				if (sshCallCount < 3) {
					throw new Error("ssh: connect to host 192.168.64.5 port 22: Connection refused");
				}
				return "";
			}
			throw new Error(`unexpected: ${bin} ${args.join(" ")}`);
		}

		const runtime = createTartRuntime({
			exec,
			sshKeyPath: "/tmp/test_key",
			pollIntervalMs: 10,
			pollMaxAttempts: 5,
		});

		assert.ok(runtime.configure, "configure should be defined");
		await runtime.configure("my-workspace", {
			TIDEPOOL_WORKSPACE_NAME: "my-workspace",
		});

		assert.equal(sshCallCount, 3);
	});

	it("configure is a no-op when TIDEPOOL_WORKSPACE_NAME is missing", async () => {
		const calls: Array<{ bin: string; args: string[] }> = [];
		async function exec(bin: string, args: string[]): Promise<string> {
			calls.push({ bin, args });
			return "";
		}

		const runtime = createTartRuntime({ exec, sshKeyPath: "/tmp/test_key" });

		assert.ok(runtime.configure, "configure should be defined");
		await runtime.configure("my-workspace", {});

		assert.equal(calls.length, 0);
	});

	it("configure throws when sshKeyPath is not set", async () => {
		async function exec(bin: string, args: string[]): Promise<string> {
			if (bin === "tart" && args[0] === "ip") {
				return "192.168.64.5";
			}
			return "";
		}

		const runtime = createTartRuntime({ exec });

		const { configure } = runtime;
		assert.ok(configure, "configure should be defined");
		await assert.rejects(
			() => configure("my-workspace", { TIDEPOOL_WORKSPACE_NAME: "my-workspace" }),
			/sshKeyPath is required/,
		);
	});
});
