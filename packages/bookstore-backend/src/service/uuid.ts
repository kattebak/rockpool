import short from "short-uuid";
import { v4 as uuidv4, v5 as uuidv5 } from "uuid";

const encoder = short(short.constants.uuid25Base36);
const namespace = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

export const generateId = (): string =>
	encoder.fromUUID(uuidv5(uuidv4(), namespace));
