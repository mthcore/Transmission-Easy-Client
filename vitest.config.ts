import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/__tests__/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    coverage: {
      // Without this, the report only lists files some test imported, so a
      // module nothing touches is ABSENT rather than shown at 0% — which reads
      // as "not a problem" instead of "completely untested". Expect the
      // headline percentage to drop when this is enabled; that is the point.
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/__tests__/**',
        'src/test/**',
        // Type-only: no statements to cover, and their presence skews the total
        'src/types/**',
      ],
    },
  },
  resolve: {
    alias: {
      // Match tsconfig baseUrl: "./src"
      tools: path.resolve(__dirname, 'src/tools'),
      components: path.resolve(__dirname, 'src/components'),
      stores: path.resolve(__dirname, 'src/stores'),
      hooks: path.resolve(__dirname, 'src/hooks'),
      types: path.resolve(__dirname, 'src/types'),
    },
  },
});
