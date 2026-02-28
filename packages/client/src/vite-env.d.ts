/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_SRV1_PORT: string | undefined;
	readonly VITE_SRV2_PORT: string | undefined;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
