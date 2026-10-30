import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base must match the GitHub Pages subpath: artofpilgrim.github.io/Dials/
export default defineConfig({
  base: '/Dials/',
  plugins: [react()],
  // Keep this app on its own origin, separate from other local Vite apps.
  server: {
    host: '127.0.0.1',
    port: 5186,
    strictPort: true,
  },
});
