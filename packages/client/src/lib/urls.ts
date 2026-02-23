const IDE_PORT = 8081;
const PREVIEW_PORT = 8082;

function buildOrigin(port: number): string {
	return `${window.location.protocol}//${window.location.hostname}:${port}`;
}

export function buildIdeUrl(workspaceName: string): string {
	return `${buildOrigin(IDE_PORT)}/workspace/${workspaceName}/`;
}

export function buildPortPreviewUrl(workspaceName: string, port: number): string {
	return `${buildOrigin(PREVIEW_PORT)}/workspace/${workspaceName}/port/${port}/`;
}
