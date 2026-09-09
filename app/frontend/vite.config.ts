import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL("..", import.meta.url)), "");
  return { plugins: [react()], server: { host: "127.0.0.1", port: Number(env.WEB_PORT || 5173), strictPort: true, proxy: { "/api": `http://127.0.0.1:${env.PORT || 8080}` } }, test: { environment: "jsdom", setupFiles: "./src/test-setup.ts" } };
});
