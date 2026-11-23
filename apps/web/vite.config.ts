import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
import {sourceCatalogPlugin} from './sourceCatalog';
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), tailwindcss(), sourceCatalogPlugin()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/', import.meta.url)) } },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] }
});
