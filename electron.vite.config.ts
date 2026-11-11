import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { CATALOGS } from './src/shared/i18n/messages'

// Minificação com esbuild nos três alvos: o electron-vite a deixa desligada por padrão, e a interface
// sairia com cerca de 2 MB sem minificar, o que pesa no carregamento em computadores fracos.
const minify = { minify: 'esbuild' as const }

/**
 * Grava um JSON por idioma em out/main/locales: o processo principal lê só o do idioma ativo e o de reserva
 * (leitura assíncrona), em vez de levar os seis catálogos dentro do index.js. JSON e não import(): o pacote
 * do processo principal é CommonJS, e lá o rollup carregaria cada pedaço com require (leitura síncrona).
 */
function localeJson(): Plugin {
  return {
    name: 'gittools-locale-json',
    generateBundle() {
      for (const [id, messages] of Object.entries(CATALOGS)) {
        this.emitFile({ type: 'asset', fileName: `locales/${id}.json`, source: JSON.stringify(messages) })
      }
    }
  }
}

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin(), localeJson()], build: minify },
  preload: { plugins: [externalizeDepsPlugin()], build: minify },
  renderer: { plugins: [react()], build: minify }
})
