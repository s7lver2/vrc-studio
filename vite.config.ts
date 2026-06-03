// vite.config.ts — reemplazar el export default por:
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
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor react — siempre en caché
          "vendor-react": ["react", "react-dom"],
          // Páginas pesadas en su propio chunk
          "page-settings": ["src/pages/Settings.tsx"],
          "page-inventory": [
            "src/pages/Inventory.tsx",
            "src/components/inventory/ScanDriveWizard.tsx",
          ],
          "page-workspace": ["src/components/workspace/WorkspacePage.tsx"],
        },
      },
    },
  },
});