/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages serves the site from /mahjong/. `VITE_BASE=/` gives clean local URLs.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/mahjong/',
  // Online rooms record the build that made them, so devices on another build get a warning.
  define: {
    __APP_BUILD__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev'),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
