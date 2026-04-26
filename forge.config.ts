import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    // Native modules (better-sqlite3) MUST be unpacked from app.asar — their
    // .node binaries can't be loaded from inside an asar archive. Vite's
    // bundling hides the dep so AutoUnpackNativesPlugin alone misses it;
    // adding an explicit unpack glob guarantees the .node files are sitting
    // in resources/app.asar.unpacked/node_modules/better-sqlite3/build/.
    asar: {
      unpack: '**/node_modules/{better-sqlite3,bindings,file-uri-to-path}/**',
    },
    name: 'CareDesk HMS',
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'caredesk_hms',
      setupExe: 'CareDesk-HMS-Setup.exe',
    }),
    // ZIP fallback for Windows + macOS — extract the zip and run the .exe
    // directly. Always works even when Squirrel's installer toolchain is
    // missing helper binaries on the build machine.
    new MakerZIP({}, ['darwin', 'win32']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  publishers: [
    new PublisherGithub({
      repository: { owner: 'mulgundsunil1918', name: 'mmcopd' },
      prerelease: false,
      draft: true, // safer: review on GitHub before publishing
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        { entry: 'src/main.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
