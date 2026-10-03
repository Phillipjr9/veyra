import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  server: {
    host: true,
    allowedHosts: true,
    // Preview frames hold their document for a long time; without this a tab can
    // keep running a bundle from before the last fix and look broken after the
    // code is already repaired. Dev only — the build is unaffected.
    headers: { "Cache-Control": "no-store" },
    // Dev proxy: run `npm run server` (port 8787) and the frontend talks to
    // the real Express API via relative /api URLs — no CORS, no localhost in browser code.
    proxy: {
      "/api": {
        target: process.env.API_URL || "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
