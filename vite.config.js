import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import pkg from './package.json' with { type: 'json' };

const appWindowTitle = `${pkg.name} v${pkg.version}`;

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_WINDOW_TITLE__: JSON.stringify(appWindowTitle),
  },
  resolve: {
    alias: {
      '@': path.resolve('./src')
    }
  },
  // 🔹 native node 모듈은 번들하지 않고 런타임에 require 되도록 외부 처리
  //    (Electron renderer는 nodeIntegration:true이므로 native require 가능)
  build: {
    rollupOptions: {
      external: ['pdfium-native', 'electron', 'fs', 'path', 'os']
    }
  },
  optimizeDeps: {
    exclude: ['pdfium-native']
  }
});
