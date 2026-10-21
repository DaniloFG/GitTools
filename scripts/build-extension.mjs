// Gera extension/dist: a extensão (esbuild) e a interface do webview (vite).
import { build as esbuild } from 'esbuild'
import { build as vite } from 'vite'
import { copyFileSync } from 'node:fs'

await vite({ configFile: 'vite.webview.config.ts', logLevel: 'warn' })

await esbuild({
  entryPoints: ['extension/src/extension.ts'],
  outfile: 'extension/dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  minify: process.env.NODE_ENV === 'production',
  logLevel: 'info'
})

copyFileSync('LICENSE', 'extension/LICENSE')
