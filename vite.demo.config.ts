import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Static-web build of CareDesk HMS for the GitHub Pages showcase.
 *
 * - Entry: demo.html → src/demo/demo-entry.tsx (mocks window.electronAPI
 *   before loading the rest of the app).
 * - base: '/mmcopd/' so the bundled JS/CSS resolve correctly when hosted
 *   under https://mulgundsunil1918.github.io/mmcopd/.
 * - Output: dist-demo/ (separate from Electron's .vite/build).
 *
 * Used by `npm run build:demo`. Not touched by Electron Forge.
 */
export default defineConfig({
  base: '/mmcopd/',
  plugins: [react()],
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'demo.html'),
      },
    },
  },
});
