import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Static-web build of CureDesk HMS for the GitHub Pages showcase + landing page.
 *
 * Two HTML inputs:
 *  - landing.html → renamed to index.html (the marketing homepage at
 *    https://mulgundsunil1918.github.io/mmcopd/).
 *  - demo.html → src/demo/demo-entry.tsx, the live React showcase that
 *    mocks window.electronAPI. Stays at /mmcopd/demo.html.
 *
 * base: '/mmcopd/' so the bundled JS/CSS resolve under the GH-Pages
 * subpath. Output: dist-demo/ (separate from Electron's .vite/build).
 *
 * Used by `npm run build:demo`. Not touched by Electron Forge.
 */

function postBuildPlugin() {
  return {
    name: 'curedesk:rename-and-fallback',
    apply: 'build' as const,
    closeBundle() {
      const dist = path.resolve(__dirname, 'dist-demo');
      // landing.html → index.html (the new homepage)
      const landingSrc = path.join(dist, 'landing.html');
      const indexDst = path.join(dist, 'index.html');
      if (fs.existsSync(landingSrc)) fs.renameSync(landingSrc, indexDst);
      // 404 fallback → load the demo so SPA deep-links into the React
      // app (#/reception etc.) work even on direct hit.
      const demoPath = path.join(dist, 'demo.html');
      if (fs.existsSync(demoPath)) {
        fs.copyFileSync(demoPath, path.join(dist, '404.html'));
      }
    },
  };
}

export default defineConfig({
  base: '/mmcopd/',
  plugins: [react(), postBuildPlugin()],
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        landing: path.resolve(__dirname, 'landing.html'),
        demo: path.resolve(__dirname, 'demo.html'),
      },
    },
  },
});
