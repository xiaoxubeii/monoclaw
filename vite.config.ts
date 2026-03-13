import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';

const monoAliases = {
  '@mono/types': resolve(__dirname, 'packages/mono-types/src/index.ts'),
  '@mono/identity': resolve(__dirname, 'packages/mono-identity/src/index.ts'),
  '@mono/handshake': resolve(__dirname, 'packages/mono-handshake/src/index.ts'),
  '@mono/protocol': resolve(__dirname, 'packages/mono-protocol/src/index.ts'),
};

// Ensure Electron launches in app mode during dev even if the shell exports this flag.
delete process.env.ELECTRON_RUN_AS_NODE;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Main process entry file
        entry: 'electron/main/index.ts',
        onstart(options) {
          options.startup();
        },
        vite: {
          resolve: {
            alias: monoAliases,
          },
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: ['electron', 'electron-store', 'electron-updater', 'ws'],
            },
          },
        },
      },
      {
        // Preload scripts entry file
        entry: 'electron/preload/index.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          resolve: {
            alias: monoAliases,
          },
          build: {
            outDir: 'dist-electron/preload',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron'),
      ...monoAliases,
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
