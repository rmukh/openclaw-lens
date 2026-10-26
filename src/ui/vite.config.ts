import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    sourcemap: false,
    outDir: '../../dist/ui',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      'geist': path.resolve(__dirname, 'node_modules/geist'),
    },
  },
  server: {
    port: 6060,
    host: true,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4242',
      '/ws': {
        target: 'ws://127.0.0.1:4242',
        ws: true,
        rewriteWsOrigin: false,
      },
    },
  },
});
