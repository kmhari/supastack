import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Anti-Multibase choices:
//  - host: '0.0.0.0' so the dev server is reachable from outside the host
//  - allowedHosts: true (we don't hardcode dev hostnames)
//  - VITE_API_URL defaults to '' → axios uses relative /api → Vite proxies in
//    dev, reverse-proxy handles it in prod. Never bake localhost:3001 into the
//    client bundle.
const PORT = Number(process.env.VITE_PORT ?? 5173);
const BACKEND = process.env.VITE_BACKEND_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: PORT,
    cors: true,
    allowedHosts: true,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/socket.io': { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
