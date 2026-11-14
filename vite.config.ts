import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Source page lives in web/; the built site is copied to the repo root
// (index.html + assets/) so GitHub Pages "Deploy from a branch" can serve it.
export default defineConfig({
  root: fileURLToPath(new URL('./web', import.meta.url)),
  base: './',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
  },
});
