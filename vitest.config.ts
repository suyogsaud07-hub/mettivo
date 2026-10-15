import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` -> `./src/*` path alias in tsconfig.json.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // The database suite boots a WASM PostgreSQL and applies every migration,
    // which is slower than a pure unit test.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
