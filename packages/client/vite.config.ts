import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.join(root, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      // WS-прокси нужен с фазы 4: иначе в dev-режиме сокет не поднимается.
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
});
