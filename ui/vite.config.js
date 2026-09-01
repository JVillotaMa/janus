import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  // Los tests puros son .test.js y los corre `node --test` desde la raíz, que
  // además puede importar el motor. Aquí solo lo que necesita un DOM.
  test: { environment: 'jsdom', include: ['src/**/*.test.jsx'], globals: true },
});
