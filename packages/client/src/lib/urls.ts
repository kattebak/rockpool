const IDE_BASE_URL = import.meta.env.VITE_IDE_URL || "http://localhost:8081";
const PREVIEW_BASE_URL = import.meta.env.VITE_PREVIEW_URL || "http://localhost:8082";

export function buildIdeUrl(workspaceName: string): string {
	return `${IDE_BASE_URL}/workspace/${workspaceName}/`;
}

export function buildPortPreviewUrl(workspaceName: string, port: number): string {
	return `${PREVIEW_BASE_URL}/workspace/${workspaceName}/port/${port}/`;
}
