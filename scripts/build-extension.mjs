// Gera extension/dist: a extensão (esbuild) e a interface do webview (vite).
import { build as esbuild } from 'esbuild'
import { build as vite } from 'vite'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'

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

// Um JSON por idioma em dist/locales: a extensão lê só o do idioma ativo e o de reserva (leitura assíncrona),
// em vez de levar os seis catálogos dentro do extension.js. JSON e não import(): o esbuild em CommonJS não
// separa pedaços, e o import() acabaria embutido no próprio arquivo. Os catálogos são TypeScript: o esbuild os
// junta em memória e o resultado é avaliado aqui só para virar JSON.
const catalogs = await esbuild({ entryPoints: ['src/shared/i18n/messages/index.ts'], bundle: true, format: 'esm', write: false, logLevel: 'warning' })
const { CATALOGS } = await import(`data:text/javascript;base64,${Buffer.from(catalogs.outputFiles[0].contents).toString('base64')}`)
mkdirSync('extension/dist/locales', { recursive: true })
for (const [id, messages] of Object.entries(CATALOGS)) writeFileSync(`extension/dist/locales/${id}.json`, JSON.stringify(messages))

copyFileSync('LICENSE', 'extension/LICENSE')
copyFileSync('THIRD_PARTY_NOTICES.md', 'extension/THIRD_PARTY_NOTICES.md')
// O vsce grava o .vsix aqui e não cria a pasta.
mkdirSync('release', { recursive: true })
