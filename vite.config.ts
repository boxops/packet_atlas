import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works at any sub-path (e.g. GitHub Pages /packet_atlas/).
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: { manualChunks: { three: ['three'] } },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
