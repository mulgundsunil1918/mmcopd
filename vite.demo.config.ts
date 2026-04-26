import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Static-web build of CareDesk HMS for the GitHub Pages showcase.
 *
 * - Entry: demo.html → src/demo/demo-entry.tsx (mocks window.electronAPI
 *   before loading the rest of the app).
 * - base: '/mmcopd/' so the bundled JS/CSS resolve correctly when hosted
 *   under https://mulgundsunil1918.github.io/mmcopd/.
 * - Output: dist-demo/ (separate from Electron's .vite/build).
 * - After build, demo.html is renamed to index.html so GitHub Pages serves
 *   it at the root URL (Pages requires index.html — not demo.html).
 *
 * Used by `npm run build:demo`. Not touched by Electron Forge.
 */

function renameToIndexPlugin() {
  return {
    name: 'caredesk:rename-demo-to-index',
    apply: 'build' as const,
    closeBundle() {
      const dist = path.resolve(__dirname, 'dist-demo');
      const src = path.join(dist, 'demo.html');
      const dst = path.join(dist, 'index.html');
      if (fs.existsSync(src)) {
        fs.renameSync(src, dst);
        // Also drop a 404.html that boots the SPA so deep links don't 404.
        fs.copyFileSync(dst, path.join(dist, '404.html'));
      }
    },
  };
}

export default defineConfig({
  base: '/mmcopd/',
  plugins: [react(), renameToIndexPlugin()],
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
