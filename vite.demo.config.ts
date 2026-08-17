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
      // Static multi-station setup/recovery guide → served at /mmcopd/multi-station.html
      // (linked from the in-app Network settings). It's a standalone HTML file.
      const guideSrc = path.resolve(__dirname, 'multi-station.html');
      if (fs.existsSync(guideSrc)) {
        fs.copyFileSync(guideSrc, path.join(dist, 'multi-station.html'));
      }
    },
  };
}

/**
 * The demo advertises its own version, so it must never be typed by hand — a
 * stale literal told every visitor the product was still on 0.3.0 while 0.6.0
 * was shipping. Read it from package.json so the showcase can only ever claim
 * the version it was actually built from.
 */
const appVersion = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'),
).version as string;

export default defineConfig({
  base: '/mmcopd/',
  define: { __DEMO_VERSION__: JSON.stringify(`${appVersion}-demo`) },
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
