import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron'),
      '@mono/types': resolve(__dirname, 'packages/mono-types/src/index.ts'),
      '@mono/identity': resolve(__dirname, 'packages/mono-identity/src/index.ts'),
      '@mono/handshake': resolve(__dirname, 'packages/mono-handshake/src/index.ts'),
      '@mono/protocol': resolve(__dirname, 'packages/mono-protocol/src/index.ts'),
    },
  },
});
