import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Use '/' for dev (Vite dev server), './' for production (file:// protocol)
const isProduction = process.env.NODE_ENV === 'production';

export default defineConfig({
  plugins: [react()],
  base: isProduction ? './' : '/',
  root: 'src/renderer',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'src/renderer/index.html'),
        dashboard: path.resolve(__dirname, 'src/renderer/dashboard.html'),
        alert: path.resolve(__dirname, 'src/renderer/alert.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    port: 5173,
  },
});
