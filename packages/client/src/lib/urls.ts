declare const __IDE_URL__: string;
declare const __PREVIEW_URL__: string;

const IDE_BASE_URL = __IDE_URL__;
const PREVIEW_BASE_URL = __PREVIEW_URL__;

export function buildIdeUrl(workspaceName: string): string {
	return `${IDE_BASE_URL}/workspace/${workspaceName}/`;
}

export function buildPortPreviewUrl(workspaceName: string, port: number): string {
	return `${PREVIEW_BASE_URL}/workspace/${workspaceName}/port/${port}/`;
}
