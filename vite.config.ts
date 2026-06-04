import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
  },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    // Target modern Chromium (Tauri's WebView) — smaller output, no legacy polyfills
    target: "chrome120",
    // Increase chunk size warning threshold (app is a desktop app, not a website)
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          // Keep React runtime isolated for best caching
          "vendor-react": ["react", "react-dom"],
          // DnD kit — heavy but shared across inventory pages
          "vendor-dnd": ["@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities"],
          // Zustand stores — shared state, never changes much
          "vendor-state": ["zustand"],
        },
      },
    },
  },
});
