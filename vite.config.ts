import { defineConfig } from 'vite';

// base './' so the built page works from file:// inside the TinyJS webview.
export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist' },
});
