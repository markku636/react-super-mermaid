import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // file: 連結的本地套件不會被 Vite 預打包,讓它即時反映 dist 變更。
  optimizeDeps: { exclude: ['react-super-mermaid'] },
});
