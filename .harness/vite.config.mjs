import { defineConfig } from 'vite';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
export default defineConfig({
  root: import.meta.dirname,
  resolve: { alias: { '@': root } },
  esbuild: { jsx: 'automatic' },
  css: { postcss: root },
  define: { 'process.env': {}, 'process.env.NODE_ENV': '"development"' },
  server: { port: 5199, fs: { allow: [root] } },
  optimizeDeps: { include: ['react', 'react-dom/client', '@tanstack/react-query', 'three', '@react-three/fiber', '@react-three/drei'] },
});
