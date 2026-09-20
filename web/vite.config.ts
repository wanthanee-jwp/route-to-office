import { defineConfig } from 'vite';

// Dev server proxies /api and /docs to the Nest backend so the frontend behaves
// exactly the same in dev as it does in prod (same origin — no CORS path).
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/docs': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
