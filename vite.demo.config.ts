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
      // Static multi-station setup/recovery guide → served at /multi-station.html
      // (linked from the in-app Network settings). It's a standalone HTML file.
      const guideSrc = path.resolve(__dirname, 'multi-station.html');
      if (fs.existsSync(guideSrc)) {
        fs.copyFileSync(guideSrc, path.join(dist, 'multi-station.html'));
      }
      // SEO static assets: robots.txt + sitemap.xml (crawling) and og-image.png
      // (the social-share / rich-link preview). Served from the site root.
      for (const f of ['robots.txt', 'sitemap.xml', 'og-image.png']) {
        const src = path.resolve(__dirname, f);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dist, f));
      }
      // Custom domain: a CNAME file in the published output tells GitHub Pages to
      // serve the site at curedesk.co.in (and 301-redirect the old
      // <user>.github.io/mmcopd/* URLs to it — so existing pamphlet QR codes keep
      // working). Must match the apex A records set at the registrar.
      fs.writeFileSync(path.join(dist, 'CNAME'), 'curedesk.co.in\n');
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
  // Served at the ROOT of the custom domain (https://curedesk.co.in/), so assets
  // resolve from '/'. (Was '/mmcopd/' when hosted under the github.io subpath.)
  base: '/',
  // __IS_DEMO__ is a COMPILE-TIME true only in the showcase build. Guarded with
  // `typeof` in code so the Electron build (where it is undefined) is unaffected,
  // and used to dead-code-eliminate personal literals (e.g. the support email)
  // out of the public bundle entirely — not just hide them at runtime.
  define: {
    __DEMO_VERSION__: JSON.stringify(`${appVersion}-demo`),
    __IS_DEMO__: 'true',
  },
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
