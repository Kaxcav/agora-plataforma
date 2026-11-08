import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://localhost:3000';

const proxy = {
  '/api': { target: API, changeOrigin: false },
  '/saude': { target: API, changeOrigin: false },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy,
  },
  preview: {
    port: 4173,
    proxy,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: true,
    // Sem scripts inline: compatível com CSP `script-src 'self'`.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    // react-dom 19 sozinho tem ~213 kB minificado; o aviso padrão não ajuda a separar o que é nosso.
    chunkSizeWarningLimit: 250,
    rollupOptions: {
      output: {
        // Bibliotecas estáveis em pedaços próprios: uma nova versão da Ágora não invalida o cache delas.
        // Ícones (lucide) ficam junto das páginas que os usam, para não entrarem na carga inicial.
        manualChunks(id: string) {
          if (/node_modules[\\/](react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react-dom';
          if (/node_modules[\\/]react[\\/]/.test(id)) return 'vendor-react';
          if (/node_modules[\\/]react-router[\\/]/.test(id)) return 'vendor-react-router';
          if (/node_modules[\\/]@tanstack[\\/]/.test(id)) return 'vendor-tanstack-query';
          return undefined;
        },
      },
    },
  },
});
