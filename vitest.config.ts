import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // `react` is external in the shipped client bundle and provided by DSH's
      // module loader; tests substitute a lazy proxy over `globalThis.React`.
      react: fileURLToPath(new URL('./tests/stubs/react.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    passWithNoTests: true,
  },
});
