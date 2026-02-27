import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface SlotAllocation {
	slot: number;
	tapName: string;
	tapIp: string;
	guestIp: string;
	guestMac: string;
	mask: number;
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

function slotToAddresses(slot: number): { tapIp: string; guestIp: string; guestMac: string } {
	const base = slot * 4;
	const tapOctet3 = (base >> 8) & 0xff;
	const tapOctet4 = (base & 0xff) + 1;
	const guestOctet4 = (base & 0xff) + 2;

	const tapIp = `172.16.${tapOctet3}.${tapOctet4}`;
	const guestIp = `172.16.${tapOctet3}.${guestOctet4}`;
	const guestMac = `06:00:AC:10:${tapOctet3.toString(16).padStart(2, "0").toUpperCase()}:${guestOctet4.toString(16).padStart(2, "0").toUpperCase()}`;

	return { tapIp, guestIp, guestMac };
}

function slotToAllocation(slot: number): SlotAllocation {
	const { tapIp, guestIp, guestMac } = slotToAddresses(slot);
	return {
		slot,
		tapName: `rp-tap${slot}`,
		tapIp,
		guestIp,
		guestMac,
		mask: 30,
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
