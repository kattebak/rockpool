import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface SlotAllocation {
	slot: number;
	tapName: string;
	guestIp: string;
	guestMac: string;
}

interface SlotState {
	allocated: Record<string, number>;
	nextSlot: number;
}

export interface SlotAllocator {
	allocate(name: string): SlotAllocation;
	release(name: string): void;
	get(name: string): SlotAllocation | undefined;
	names(): string[];
	load(): void;
	save(): void;
}

function slotToAddresses(slot: number): { guestIp: string; guestMac: string } {
	const offset = slot + 2;
	const octet3 = (offset >> 8) & 0xff;
	const octet4 = offset & 0xff;

	const guestIp = `172.16.${octet3}.${octet4}`;
	const guestMac = `06:00:AC:10:${octet3.toString(16).padStart(2, "0").toUpperCase()}:${octet4.toString(16).padStart(2, "0").toUpperCase()}`;

	return { guestIp, guestMac };
}

function slotToAllocation(slot: number): SlotAllocation {
	const { guestIp, guestMac } = slotToAddresses(slot);
	return {
		slot,
		tapName: `rp-tap${slot}`,
		guestIp,
		guestMac,
	};
}

export function createSlotAllocator(filePath: string): SlotAllocator {
	let state: SlotState = { allocated: {}, nextSlot: 0 };
	const freed: number[] = [];

	function load(): void {
		try {
			const raw = readFileSync(filePath, "utf-8");
			const parsed: unknown = JSON.parse(raw);
			if (
				typeof parsed === "object" &&
				parsed !== null &&
				"allocated" in parsed &&
				"nextSlot" in parsed
			) {
				const obj = parsed as SlotState;
				state = { allocated: { ...obj.allocated }, nextSlot: obj.nextSlot };
				freed.length = 0;
			}
		} catch {
			state = { allocated: {}, nextSlot: 0 };
			freed.length = 0;
		}
	}

	function save(): void {
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, JSON.stringify(state, null, 2));
	}

	function allocate(name: string): SlotAllocation {
		if (state.allocated[name] !== undefined) {
			return slotToAllocation(state.allocated[name]);
		}

		const slot = freed.length > 0 ? (freed.pop() as number) : state.nextSlot++;
		state.allocated[name] = slot;
		save();
		return slotToAllocation(slot);
	}

	function release(name: string): void {
		const slot = state.allocated[name];
		if (slot === undefined) {
			return;
		}
		freed.push(slot);
		delete state.allocated[name];
		save();
	}

	function get(name: string): SlotAllocation | undefined {
		const slot = state.allocated[name];
		if (slot === undefined) {
			return undefined;
		}
		return slotToAllocation(slot);
	}

	function names(): string[] {
		return Object.keys(state.allocated);
	}

	return { allocate, release, get, names, load, save };
}
