import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    open: "/src/matrix/stay_willingness_matrix.html",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "src/matrix/stay_willingness_matrix.html"),
    },
  },
});
