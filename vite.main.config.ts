import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Vite externalises native Node modules (better-sqlite3 has C++ bindings
 * that can't be bundled). But @electron-forge/plugin-vite only ships what
 * Vite outputs into .vite/build — it does NOT auto-copy externalised deps
 * from node_modules. Result: the packaged app.asar has main.js with a
 * require('better-sqlite3') that fails at launch.
 *
 * Fix: a tiny closeBundle plugin that physically copies the externalised
 * native modules into .vite/build/node_modules/ AFTER Vite finishes. Forge
 * then includes them in the asar; the packagerConfig.asar.unpack glob in
 * forge.config.ts pulls them back out so the .node files are loadable.
 */
const NATIVE_DEPS = ['better-sqlite3', 'bindings', 'file-uri-to-path'];

function copyDirSync(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

function copyNativeModulesPlugin() {
  return {
    name: 'caredesk:copy-native-modules',
    apply: 'build' as const,
    closeBundle() {
      const projectRoot = process.cwd();
      const buildNodeModules = path.join(projectRoot, '.vite', 'build', 'node_modules');
      for (const dep of NATIVE_DEPS) {
        const src = path.join(projectRoot, 'node_modules', dep);
        const dst = path.join(buildNodeModules, dep);
        if (!fs.existsSync(src)) {
          console.warn(`[caredesk] native dep '${dep}' not found at ${src} — skipping`);
          continue;
        }
        try {
          fs.rmSync(dst, { recursive: true, force: true });
          copyDirSync(src, dst);
        } catch (err) {
          console.error(`[caredesk] failed to copy ${dep}:`, err);
        }
      }
    },
  };
}

export default defineConfig({
  build: {
    rollupOptions: {
      external: NATIVE_DEPS,
    },
  },
  plugins: [copyNativeModulesPlugin()],
  resolve: {
    browserField: false,
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
});
