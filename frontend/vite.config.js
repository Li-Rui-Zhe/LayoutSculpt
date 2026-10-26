import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { frontendPort, frontendPortGuard } from "../scripts/frontend-port.mjs";

const proxy = {
  "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
};
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: "../public",
  plugins: [react(), frontendPortGuard],
  server: {
    host: "127.0.0.1",
    port: frontendPort,
    strictPort: true,
    proxy,
    watch: { awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 } },
  },
  preview: { host: "127.0.0.1", port: frontendPort, strictPort: true, proxy },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "three", test: /node_modules[\\/]three/ },
            {
              name: "react",
              test: /node_modules[\\/](react|react-dom|scheduler)/,
            },
          ],
        },
      },
    },
  },
});
