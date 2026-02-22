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

	it("start calls tart run with --no-graphics", async () => {
		const { exec, calls } = createMockExec(new Map([["tart run my-workspace --no-graphics", ""]]));
		const runtime = createTartRuntime({ exec });

		await runtime.start("my-workspace");

		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0].args, ["run", "my-workspace", "--no-graphics"]);
	});

	it("status returns running when VM is running", async () => {
		const tartListOutput =
			"Source\tName\tDisk\tSize\tState\tOS\nlocal\tmy-workspace\t20480\t1024\trunning\tlinux";
		const { exec } = createMockExec(new Map([["tart list", tartListOutput]]));
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
});
