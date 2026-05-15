/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// GitHub Pages serves this project from /mahjong/ (repo: DragonKyro/mahjong).
// Override with `VITE_BASE=/` when running locally if you want clean URLs.
const base = process.env.VITE_BASE ?? '/mahjong/';

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@store': path.resolve(__dirname, 'src/store'),
      '@multiplayer': path.resolve(__dirname, 'src/multiplayer'),
      '@training': path.resolve(__dirname, 'src/training'),
      '@utils': path.resolve(__dirname, 'src/utils'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
  },
});
