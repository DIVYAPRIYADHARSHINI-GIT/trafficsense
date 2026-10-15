import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Public base path (where the app is served from):
//   VITE_BASE_PATH (or the older VITE_BASE) wins when set, e.g. "/" or "/trafficsense/".
//   On Vercel (VERCEL=1 is set during builds) the default is "/".
//   Other production builds default to "/trafficsense/" (GitHub Pages project site,
//   https://<user>.github.io/trafficsense/). The dev server always defaults to "/".
//
// Backend URL: VITE_API_URL (default http://localhost:8000) is baked into the bundle by
// src/api.js. Set it to the Render URL in the GitHub Actions workflow / Vercel project.
export function resolveBase(command, env) {
  let base = env.VITE_BASE_PATH || env.VITE_BASE;
  if (!base) base = command === 'build' && !env.VERCEL ? '/trafficsense/' : '/';
  if (!base.startsWith('/')) base = `/${base}`;
  if (!base.endsWith('/')) base += '/';
  return base;
}

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), VERCEL: process.env.VERCEL };
  const base = resolveBase(command, env);
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

/**
 * Write the real base path into dist/404.html (GitHub Pages deep-link fallback).
 * Vercel ignores this file for routing: frontend/vercel.json rewrites deep links instead.
 */
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
