import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A mesma interface do aplicativo, empacotada para rodar num webview da extensão do VS Code.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: { outDir: '../../extension/dist/webview', emptyOutDir: true, chunkSizeWarningLimit: 2000 }
})
