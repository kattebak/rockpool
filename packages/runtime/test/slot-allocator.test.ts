import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createSlotAllocator } from "../src/slot-allocator.ts";

describe("SlotAllocator", () => {
	let tempDir: string;
	let slotsFile: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "slot-alloc-test-"));
		slotsFile = join(tempDir, "slots.json");
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("allocates monotonically increasing slot numbers", () => {
		const allocator = createSlotAllocator(slotsFile);

		const a = allocator.allocate("workspace-a");
		const b = allocator.allocate("workspace-b");
		const c = allocator.allocate("workspace-c");

		assert.equal(a.slot, 0);
		assert.equal(b.slot, 1);
		assert.equal(c.slot, 2);
	});

	it("returns correct TAP names", () => {
		const allocator = createSlotAllocator(slotsFile);

		const a = allocator.allocate("workspace-a");
		const b = allocator.allocate("workspace-b");

		assert.equal(a.tapName, "rp-tap0");
		assert.equal(b.tapName, "rp-tap1");
	});

	it("computes correct IPs for slot 0", () => {
		const allocator = createSlotAllocator(slotsFile);
		const alloc = allocator.allocate("workspace-a");

		assert.equal(alloc.tapIp, "172.16.0.1");
		assert.equal(alloc.guestIp, "172.16.0.2");
		assert.equal(alloc.mask, 30);
	});

	it("computes correct IPs for slot 1", () => {
		const allocator = createSlotAllocator(slotsFile);
		allocator.allocate("workspace-a");
		const alloc = allocator.allocate("workspace-b");

		assert.equal(alloc.tapIp, "172.16.0.5");
		assert.equal(alloc.guestIp, "172.16.0.6");
	});

	it("computes correct IPs for slot 2", () => {
		const allocator = createSlotAllocator(slotsFile);
		allocator.allocate("workspace-a");
		allocator.allocate("workspace-b");
		const alloc = allocator.allocate("workspace-c");

		assert.equal(alloc.tapIp, "172.16.0.9");
		assert.equal(alloc.guestIp, "172.16.0.10");
	});

	it("computes correct MAC addresses", () => {
		const allocator = createSlotAllocator(slotsFile);
		const a = allocator.allocate("workspace-a");
		const b = allocator.allocate("workspace-b");

		assert.equal(a.guestMac, "06:00:AC:10:00:02");
		assert.equal(b.guestMac, "06:00:AC:10:00:06");
	});

	it("returns same allocation for existing name", () => {
		const allocator = createSlotAllocator(slotsFile);
		const first = allocator.allocate("workspace-a");
		const second = allocator.allocate("workspace-a");

		assert.deepEqual(first, second);
	});

	it("releasing a slot makes it available for reuse", () => {
		const allocator = createSlotAllocator(slotsFile);
		allocator.allocate("workspace-a");
		const b = allocator.allocate("workspace-b");
		allocator.allocate("workspace-c");

		allocator.release("workspace-b");

		const d = allocator.allocate("workspace-d");
		assert.equal(d.slot, b.slot);
		assert.equal(d.tapName, b.tapName);
	});

	it("get returns the allocation for an existing VM", () => {
		const allocator = createSlotAllocator(slotsFile);
		const allocated = allocator.allocate("workspace-a");
		const retrieved = allocator.get("workspace-a");

		assert.deepEqual(retrieved, allocated);
	});

	it("get returns undefined for a non-existent VM", () => {
		const allocator = createSlotAllocator(slotsFile);
		const result = allocator.get("nonexistent");

		assert.equal(result, undefined);
	});

	it("release is a no-op for a non-existent VM", () => {
		const allocator = createSlotAllocator(slotsFile);
		allocator.release("nonexistent");
	});

	it("state round-trips through save and load", () => {
		const allocator1 = createSlotAllocator(slotsFile);
		allocator1.allocate("workspace-a");
		allocator1.allocate("workspace-b");

		const allocator2 = createSlotAllocator(slotsFile);
		allocator2.load();

		const a = allocator2.get("workspace-a");
		const b = allocator2.get("workspace-b");

		assert.ok(a);
		assert.ok(b);
		assert.equal(a.slot, 0);
		assert.equal(b.slot, 1);
		assert.equal(a.guestIp, "172.16.0.2");
		assert.equal(b.guestIp, "172.16.0.6");
	});

	it("new allocations after load continue from nextSlot", () => {
		const allocator1 = createSlotAllocator(slotsFile);
		allocator1.allocate("workspace-a");
		allocator1.allocate("workspace-b");

		const allocator2 = createSlotAllocator(slotsFile);
		allocator2.load();
		const c = allocator2.allocate("workspace-c");

		assert.equal(c.slot, 2);
	});

	it("persists state to disk on allocate", () => {
		const allocator = createSlotAllocator(slotsFile);
		allocator.allocate("workspace-a");

		const raw = readFileSync(slotsFile, "utf-8");
		const parsed = JSON.parse(raw);
		assert.equal(parsed.allocated["workspace-a"], 0);
		assert.equal(parsed.nextSlot, 1);
	});

	it("persists state to disk on release", () => {
		const allocator = createSlotAllocator(slotsFile);
		allocator.allocate("workspace-a");
		allocator.release("workspace-a");

		const raw = readFileSync(slotsFile, "utf-8");
		const parsed = JSON.parse(raw);
		assert.equal(parsed.allocated["workspace-a"], undefined);
	});

	it("load handles missing file gracefully", () => {
		const allocator = createSlotAllocator(join(tempDir, "nonexistent", "slots.json"));
		allocator.load();

		const result = allocator.get("anything");
		assert.equal(result, undefined);
	});

	it("load handles corrupted file gracefully", () => {
		const corruptedPath = join(tempDir, "corrupted.json");
		writeFileSync(corruptedPath, "not json");

		const allocator = createSlotAllocator(corruptedPath);
		allocator.load();

		const result = allocator.get("anything");
		assert.equal(result, undefined);
	});
});
