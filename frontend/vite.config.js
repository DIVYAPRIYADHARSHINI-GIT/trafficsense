import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Base path: GitHub Pages serves the project site at https://<user>.github.io/trafficsense/,
// so production builds use "/trafficsense/". Local dev uses "/" (override with VITE_BASE).
//
// Backend URL: VITE_API_URL (default http://localhost:8000) is baked into the bundle by
// src/api.js. The GitHub Actions workflow sets it to the Render URL at build time.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  let base = env.VITE_BASE || (command === 'build' ? '/trafficsense/' : '/');
  if (!base.endsWith('/')) base += '/';
  return {
    base,
    plugins: [react(), spaFallback(base)],
    server: { port: 5173 },
    preview: { port: 4173 },
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks: { recharts: ['recharts'], react: ['react', 'react-dom', 'react-router-dom'] },
        },
      },
    },
  };
});

/** Write the real base path into dist/404.html (GitHub Pages deep-link fallback). */
function spaFallback(base) {
  let outDir = 'dist';
  return {
    name: 'trafficsense-spa-fallback',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const file = path.join(outDir, '404.html');
      if (fs.existsSync(file)) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('__BASE__', base));
    },
  };
}
