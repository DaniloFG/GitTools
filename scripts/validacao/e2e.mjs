// Ponta a ponta na interface de verdade: o repositório de exemplo aberto num Chromium ligado ao Backend real
// (harness de scripts/readme-media, receita da skill run-gittools). Os cenários são dados em
// scripts/validacao/e2e/cenarios/; a execução está em scripts/validacao/e2e/runner.mjs.
//   npm run build:extension && node scripts/validacao/e2e.mjs
// Códigos de saída: 0 passou; 1 falhou (prints em validacao-out/e2e-falha-<id>.png); 3 Playwright/Chromium ausentes.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { RAIZ } from './lib.mjs'
import { rodarE2e } from './e2e/runner.mjs'

function sair(codigo) {
  // Chromium e servidor podem demorar a soltar o processo: a decisão já foi tomada.
  process.exit(codigo)
}

if (!existsSync(join(RAIZ, 'extension/dist/webview/index.html'))) {
  console.error('e2e: a interface não foi compilada (rode `npm run build:extension` antes)')
  sair(1)
}

// Trava de segurança: uma tela que nunca carrega não pode prender o pipeline até o limite do CI.
setTimeout(() => {
  console.error('e2e: excedeu 3 minutos')
  sair(1)
}, 180_000).unref()

let codigo
try {
  codigo = await rodarE2e()
} catch (erro) {
  console.error(`e2e: erro no roteiro: ${erro?.stack ?? erro}`)
  codigo = 1
}
sair(codigo)
