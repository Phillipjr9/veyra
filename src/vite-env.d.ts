/// <reference types="vite/client" />

/**
 * Vite's `import.meta.env` (DEV / PROD / MODE). Declared explicitly because the
 * project pins `types: ["node"]` in tsconfig; the dev-only demo login panel
 * reads `import.meta.env.DEV` to decide whether to render credentials.
 */
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  readonly BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Build/server stamp, injected by vite.config.ts (dev diagnostic). */
declare const __BUILD_STAMP__: string;
