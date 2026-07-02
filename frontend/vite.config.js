import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Minimal konfig: react-plugin er med fra start (brukes fra steg 2),
// alt annet er Vite-defaults. index.html i frontend/ er entry,
// public/ serveres på rot (favicons, /img/plant-*.png).
export default defineConfig({
  plugins: [react()],
});
