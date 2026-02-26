import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

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

const SUBNET_PREFIX = "172.16";
const TAP_IP_BASE = 1;
const MASK = 30;

export interface SlotAllocatorOptions {
	basePath?: string;
	subnetPrefix?: string;
}

export function createSlotAllocator(options: SlotAllocatorOptions = {}): {
	allocate(name: string): SlotAllocation;
	release(name: string): void;
	get(name: string): SlotAllocation | undefined;
	load(): void;
	save(): void;
} {
	const basePath = options.basePath ?? ".firecracker";
	const subnetPrefix = options.subnetPrefix ?? SUBNET_PREFIX;
	const slotsFile = join(basePath, "slots.json");

	let state: SlotState = {
		allocated: {},
		nextSlot: 0,
	};

	function computeAllocation(slot: number): SlotAllocation {
		const slotOffset = slot * 4;

		// TAP IP on host side: 172.16.X.Y where X = (slot*4) >> 8, Y = (slot*4) & 0xFF + 1
		const tapIpOctet3 = (slotOffset >> 8) & 0xff;
		const tapIpOctet4 = (slotOffset & 0xff) + TAP_IP_BASE;

		// Guest IP: next address in the /30
		const guestIpOctet3 = tapIpOctet3;
		const guestIpOctet4 = tapIpOctet4 + 1;

		// Guest MAC: 06:00:AC:10:XX:YY where XXYY is guest IP bytes
		const macOctet5 = guestIpOctet3.toString(16).padStart(2, "0");
		const macOctet6 = guestIpOctet4.toString(16).padStart(2, "0");

		return {
			slot,
			tapName: `rp-tap${slot}`,
			tapIp: `${subnetPrefix}.${tapIpOctet3}.${tapIpOctet4}`,
			guestIp: `${subnetPrefix}.${guestIpOctet3}.${guestIpOctet4}`,
			guestMac: `06:00:AC:10:${macOctet5}:${macOctet6}`,
			mask: MASK,
		};
	}

	return {
		allocate(name: string): SlotAllocation {
			const slot = state.nextSlot++;
			state.allocated[name] = slot;
			this.save();
			return computeAllocation(slot);
		},

		release(name: string): void {
			delete state.allocated[name];
			this.save();
		},

		get(name: string): SlotAllocation | undefined {
			const slot = state.allocated[name];
			if (slot === undefined) {
				return undefined;
			}
			return computeAllocation(slot);
		},

		load(): void {
			if (!existsSync(slotsFile)) {
				return;
			}
			try {
				const content = readFileSync(slotsFile, "utf-8");
				state = JSON.parse(content);
			} catch {
				// If file is corrupted, start fresh
				state = { allocated: {}, nextSlot: 0 };
			}
		},

		save(): void {
			try {
				mkdirSync(dirname(slotsFile), { recursive: true });
				writeFileSync(slotsFile, JSON.stringify(state, null, 2));
			} catch {
				// Ignore save errors
			}
		},
	};
}
