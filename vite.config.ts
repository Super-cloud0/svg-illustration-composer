import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the app from /svg-illustration-composer/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/svg-illustration-composer/' : '/',
  plugins: [react()],
}));
