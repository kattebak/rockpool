/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_IDE_URL: string | undefined;
	readonly VITE_PREVIEW_URL: string | undefined;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
