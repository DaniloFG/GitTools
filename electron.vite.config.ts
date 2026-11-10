import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Minificação com esbuild nos três alvos: o electron-vite a deixa desligada por padrão, e a interface
// sairia com cerca de 2 MB sem minificar, o que pesa no carregamento em computadores fracos.
const minify = { minify: 'esbuild' as const }

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: minify },
  preload: { plugins: [externalizeDepsPlugin()], build: minify },
  renderer: { plugins: [react()], build: minify }
})
