import { defineConfig } from 'vite';

const page = (p: string) => new URL(p, import.meta.url).pathname;

export default defineConfig({
  server: {
    // In dev, only the optional report-storage API needs the Node backend; samples are served
    // straight from public/. The live board talks to lichess directly (no backend required).
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: page('./index.html'),
        analyze: page('./analyze.html'),
        live: page('./live.html'),
        swiss: page('./swiss.html'),
        openingExplorer: page('./opening-explorer.html'),
        rating: page('./rating.html'),
        fideRating: page('./fide-rating.html'),
      },
    },
  },
});
