import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPodmanRuntime } from "../src/podman-runtime.ts";

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

function createSequentialMockExec() {
	const calls: Array<{ bin: string; args: string[] }> = [];
	const responses: Array<{ match: (bin: string, args: string[]) => boolean; value: string }> = [];

	async function exec(bin: string, args: string[]): Promise<string> {
		calls.push({ bin, args });
		for (const response of responses) {
			if (response.match(bin, args)) {
				return response.value;
			}
		}
		return "";
	}

	function when(matchFn: (bin: string, args: string[]) => boolean, value: string): void {
		responses.push({ match: matchFn, value });
	}

	return { exec, calls, when };
}

const INSPECT_RUNNING = JSON.stringify([
	{
		State: { Status: "running", Running: true },
		NetworkSettings: { IPAddress: "10.88.0.2" },
	},
]);

const INSPECT_STOPPED = JSON.stringify([
	{
		State: { Status: "exited", Running: false },
		NetworkSettings: { IPAddress: "" },
	},
]);

describe("PodmanRuntime", () => {
	describe("create", () => {
		it("calls podman create with correct arguments", async () => {
			const { exec, calls } = createMockExec(
				new Map([
					[
						"podman create --name my-workspace -P --userns=auto --cpus=2 --memory=4g --volume my-workspace-data:/home/admin rockpool-workspace:latest",
						"abc123",
					],
				]),
			);
			const runtime = createPodmanRuntime({ exec });

			await runtime.create("my-workspace", "rockpool-workspace:latest");

			assert.equal(calls.length, 1);
			assert.equal(calls[0].bin, "podman");
			assert.deepEqual(calls[0].args, [
				"create",
				"--name",
				"my-workspace",
				"-P",
				"--userns=auto",
				"--cpus=2",
				"--memory=4g",
				"--volume",
				"my-workspace-data:/home/admin",
				"rockpool-workspace:latest",
			]);
		});

		it("uses default image when empty string is provided", async () => {
			const { exec, calls } = createMockExec(
				new Map([
					[
						"podman create --name my-workspace -P --userns=auto --cpus=2 --memory=4g --volume my-workspace-data:/home/admin rockpool-workspace:latest",
						"abc123",
					],
				]),
			);
			const runtime = createPodmanRuntime({ exec });

			await runtime.create("my-workspace", "");

			assert.equal(calls.length, 1);
			assert.equal(calls[0].args[calls[0].args.length - 1], "rockpool-workspace:latest");
		});

		it("respects custom cpus and memory options", async () => {
			const { exec, calls } = createMockExec(
				new Map([
					[
						"podman create --name my-workspace -P --userns=auto --cpus=4 --memory=8g --volume my-workspace-data:/home/admin rockpool-workspace:latest",
						"abc123",
					],
				]),
			);
			const runtime = createPodmanRuntime({ exec, cpus: 4, memory: "8g" });

			await runtime.create("my-workspace", "rockpool-workspace:latest");

			assert.equal(calls.length, 1);
			assert.ok(calls[0].args.includes("--cpus=4"));
			assert.ok(calls[0].args.includes("--memory=8g"));
		});
	});

	describe("start", () => {
		it("calls podman start with container name", async () => {
			const { exec, calls } = createMockExec(
				new Map([["podman start my-workspace", "my-workspace"]]),
			);
			const runtime = createPodmanRuntime({ exec });

			await runtime.start("my-workspace");

			assert.equal(calls.length, 1);
			assert.equal(calls[0].bin, "podman");
			assert.deepEqual(calls[0].args, ["start", "my-workspace"]);
		});
	});

	describe("stop", () => {
		it("calls podman stop with container name and timeout", async () => {
			const { exec, calls } = createMockExec(
				new Map([["podman stop --time 10 my-workspace", "my-workspace"]]),
			);
			const runtime = createPodmanRuntime({ exec });

			await runtime.stop("my-workspace");

			assert.equal(calls.length, 1);
			assert.equal(calls[0].bin, "podman");
			assert.deepEqual(calls[0].args, ["stop", "--time", "10", "my-workspace"]);
		});
	});

	describe("remove", () => {
		it("calls podman rm with container name", async () => {
			const { exec, calls } = createMockExec(new Map([["podman rm my-workspace", "my-workspace"]]));
			const runtime = createPodmanRuntime({ exec });

			await runtime.remove("my-workspace");

			assert.equal(calls.length, 1);
			assert.equal(calls[0].bin, "podman");
			assert.deepEqual(calls[0].args, ["rm", "my-workspace"]);
		});
	});

	describe("status", () => {
		it("returns running when container is running", async () => {
			const { exec } = createMockExec(new Map([["podman inspect my-workspace", INSPECT_RUNNING]]));
			const runtime = createPodmanRuntime({ exec });

			const result = await runtime.status("my-workspace");
			assert.equal(result, "running");
		});

		it("returns stopped when container is exited", async () => {
			const { exec } = createMockExec(new Map([["podman inspect my-workspace", INSPECT_STOPPED]]));
			const runtime = createPodmanRuntime({ exec });

			const result = await runtime.status("my-workspace");
			assert.equal(result, "stopped");
		});

		it("returns not_found when container does not exist", async () => {
			async function exec(): Promise<string> {
				throw new Error("no such container");
			}
			const runtime = createPodmanRuntime({ exec });

			const result = await runtime.status("nonexistent");
			assert.equal(result, "not_found");
		});
	});

	describe("getIp", () => {
		it("returns localhost dial address from podman port output", async () => {
			const { exec } = createMockExec(
				new Map([["podman port my-workspace 8080", "0.0.0.0:39493"]]),
			);
			const runtime = createPodmanRuntime({ exec });

			const ip = await runtime.getIp("my-workspace");
			assert.equal(ip, "127.0.0.1:39493");
		});

		it("throws when no port mapping is returned", async () => {
			const { exec } = createMockExec(new Map([["podman port my-workspace 8080", ""]]));
			const runtime = createPodmanRuntime({ exec });

			await assert.rejects(() => runtime.getIp("my-workspace"), {
				message: 'Podman: no port mapping for container "my-workspace"',
			});
		});

		it("throws when port output format is unexpected", async () => {
			const { exec } = createMockExec(
				new Map([["podman port my-workspace 8080", "invalid-output"]]),
			);
			const runtime = createPodmanRuntime({ exec });

			await assert.rejects(() => runtime.getIp("my-workspace"), {
				message: /unexpected port output/,
			});
		});
	});

	describe("configure", () => {
		it("writes code-server config and restarts container", async () => {
			const mock = createSequentialMockExec();
			mock.when((bin, args) => bin === "podman" && args[0] === "exec", "");
			mock.when((bin, args) => bin === "podman" && args[0] === "restart", "");
			mock.when((bin, args) => bin === "podman" && args[0] === "inspect", "true");
			const runtime = createPodmanRuntime({ exec: mock.exec });

			assert.ok(runtime.configure, "configure should be defined");
			await runtime.configure("my-workspace", {
				ROCKPOOL_WORKSPACE_NAME: "my-workspace",
			});

			assert.equal(mock.calls.length, 3);

			const configCall = mock.calls[0];
			assert.equal(configCall.bin, "podman");
			assert.equal(configCall.args[0], "exec");
			assert.equal(configCall.args[1], "my-workspace");
			const configCmd = configCall.args[configCall.args.length - 1];
			assert.ok(configCmd.includes("/workspace/my-workspace"));
			assert.ok(configCmd.includes("config.yaml"));

			const restartCall = mock.calls[1];
			assert.equal(restartCall.bin, "podman");
			assert.deepEqual(restartCall.args, ["restart", "--time", "2", "my-workspace"]);
		});

		it("writes workspace-folder file when ROCKPOOL_FOLDER is set", async () => {
			const mock = createSequentialMockExec();
			mock.when((bin, args) => bin === "podman" && args[0] === "exec", "");
			mock.when((bin, args) => bin === "podman" && args[0] === "restart", "");
			mock.when((bin, args) => bin === "podman" && args[0] === "inspect", "true");
			const runtime = createPodmanRuntime({ exec: mock.exec });

			assert.ok(runtime.configure, "configure should be defined");
			await runtime.configure("my-workspace", {
				ROCKPOOL_WORKSPACE_NAME: "my-workspace",
				ROCKPOOL_FOLDER: "/home/admin/my-project",
			});

			assert.equal(mock.calls.length, 3);
			const configCmd = mock.calls[0].args[mock.calls[0].args.length - 1];
			assert.ok(configCmd.includes("workspace-folder"));
			assert.ok(configCmd.includes("/home/admin/my-project"));
		});

		it("is a no-op when ROCKPOOL_WORKSPACE_NAME is missing", async () => {
			const mock = createSequentialMockExec();
			const runtime = createPodmanRuntime({ exec: mock.exec });

			assert.ok(runtime.configure, "configure should be defined");
			await runtime.configure("my-workspace", {});

			assert.equal(mock.calls.length, 0);
		});
	});

	describe("clone", () => {
		it("runs git clone via podman exec without token", async () => {
			const mock = createSequentialMockExec();
			mock.when((bin, args) => bin === "podman" && args[0] === "exec", "");
			const runtime = createPodmanRuntime({ exec: mock.exec });

			assert.ok(runtime.clone, "clone should be defined");
			await runtime.clone("my-workspace", "10.88.0.2", "octocat/Hello-World");

			assert.equal(mock.calls.length, 1);
			const cloneCall = mock.calls[0];
			assert.equal(cloneCall.bin, "podman");
			assert.deepEqual(cloneCall.args.slice(0, 2), ["exec", "my-workspace"]);
			const cloneCmd = cloneCall.args[cloneCall.args.length - 1];
			assert.ok(cloneCmd.includes("git clone --depth 1 --single-branch"));
			assert.ok(cloneCmd.includes("https://github.com/octocat/Hello-World.git"));
			assert.ok(cloneCmd.includes("/home/admin/Hello-World"));
		});

		it("writes credential helper and runs git clone with token", async () => {
			const mock = createSequentialMockExec();
			mock.when((bin, args) => bin === "podman" && args[0] === "exec", "");
			const runtime = createPodmanRuntime({ exec: mock.exec });

			assert.ok(runtime.clone, "clone should be defined");
			await runtime.clone("my-workspace", "10.88.0.2", "octocat/Hello-World", "ghp_testtoken123");

			assert.equal(mock.calls.length, 3);

			const credentialCmd = mock.calls[0].args[mock.calls[0].args.length - 1];
			assert.ok(credentialCmd.includes(".rockpool/git-credential-helper"));
			assert.ok(credentialCmd.includes("ghp_testtoken123"));
			assert.ok(credentialCmd.includes("chmod +x"));

			const gitConfigCmd = mock.calls[1].args[mock.calls[1].args.length - 1];
			assert.ok(gitConfigCmd.includes("git config --global credential.helper"));
			assert.ok(gitConfigCmd.includes(".rockpool/git-credential-helper"));

			const cloneCmd = mock.calls[2].args[mock.calls[2].args.length - 1];
			assert.ok(cloneCmd.includes("git clone --depth 1 --single-branch"));
			assert.ok(cloneCmd.includes("https://github.com/octocat/Hello-World.git"));
		});
	});

	describe("readFile", () => {
		it("reads file via podman exec cat", async () => {
			const { exec, calls } = createMockExec(
				new Map([
					[
						"podman exec my-workspace cat /home/admin/.config/code-server/config.yaml",
						"bind-addr: 0.0.0.0:8080",
					],
				]),
			);
			const runtime = createPodmanRuntime({ exec });

			assert.ok(runtime.readFile, "readFile should be defined");
			const content = await runtime.readFile(
				"my-workspace",
				"10.88.0.2",
				".config/code-server/config.yaml",
			);

			assert.equal(content, "bind-addr: 0.0.0.0:8080");
			assert.equal(calls.length, 1);
			assert.equal(calls[0].bin, "podman");
			assert.deepEqual(calls[0].args, [
				"exec",
				"my-workspace",
				"cat",
				"/home/admin/.config/code-server/config.yaml",
			]);
		});
	});

	describe("writeFile", () => {
		it("writes file via podman exec with mkdir", async () => {
			const mock = createSequentialMockExec();
			mock.when((bin, args) => bin === "podman" && args[0] === "exec", "");
			const runtime = createPodmanRuntime({ exec: mock.exec });

			assert.ok(runtime.writeFile, "writeFile should be defined");
			await runtime.writeFile(
				"my-workspace",
				"10.88.0.2",
				".config/code-server/config.yaml",
				"bind-addr: 0.0.0.0:8080",
			);

			assert.equal(mock.calls.length, 1);
			const writeCall = mock.calls[0];
			assert.equal(writeCall.bin, "podman");
			assert.deepEqual(writeCall.args.slice(0, 2), ["exec", "my-workspace"]);
			const writeCmd = writeCall.args[writeCall.args.length - 1];
			assert.ok(writeCmd.includes("mkdir -p /home/admin/.config/code-server"));
			assert.ok(writeCmd.includes("config.yaml"));
			assert.ok(writeCmd.includes("bind-addr: 0.0.0.0:8080"));
		});

		it("skips mkdir for files with no directory component", async () => {
			const mock = createSequentialMockExec();
			mock.when((bin, args) => bin === "podman" && args[0] === "exec", "");
			const runtime = createPodmanRuntime({ exec: mock.exec });

			assert.ok(runtime.writeFile, "writeFile should be defined");
			await runtime.writeFile("my-workspace", "10.88.0.2", ".gitconfig", "[user]\nname=test");

			assert.equal(mock.calls.length, 1);
			const writeCmd = mock.calls[0].args[mock.calls[0].args.length - 1];
			assert.ok(!writeCmd.includes("mkdir"), "should not mkdir for root-level file");
			assert.ok(writeCmd.includes(".gitconfig"));
		});

		it("escapes single quotes in content", async () => {
			const mock = createSequentialMockExec();
			mock.when((bin, args) => bin === "podman" && args[0] === "exec", "");
			const runtime = createPodmanRuntime({ exec: mock.exec });

			assert.ok(runtime.writeFile, "writeFile should be defined");
			await runtime.writeFile("my-workspace", "10.88.0.2", "test.txt", "it's a test");

			const writeCmd = mock.calls[0].args[mock.calls[0].args.length - 1];
			assert.ok(writeCmd.includes("it'\\''s a test"));
		});
	});
});
