// Ponta a ponta na interface de verdade: o repositório de exemplo aberto num Chromium ligado ao Backend real
// (harness de scripts/readme-media, receita da skill run-gittools). Percorre as telas principais, confere que
// cada uma desenha conteúdo e reprova com erro de página/console ou com processo git inesperado.
//   npm run build:extension && node scripts/validacao/e2e.mjs
// Códigos de saída: 0 passou; 1 falhou (print em validacao-out/e2e-falha.png); 3 Playwright/Chromium ausentes.
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { newApp } from '../readme-media/lib.mjs'
import { classificarErros, gitInesperado, RAIZ, SAIDA } from './lib.mjs'

const INDISPONIVEL = 3
const LIMITE_NOS_DOM = 5000
const PRINT = join(SAIDA, 'e2e-falha.png')

/** Cada tela: o botão do topo, o que ela tem de desenhar e quantos itens no mínimo (o exemplo tem 11 commits). */
const TELAS = [
  { nome: 'History', aba: { hasText: 'History' }, seletor: '.commit-row', minimo: 5 },
  { nome: 'Changes', aba: { hasText: 'Changes' }, seletor: '.file-item', minimo: 1 },
  { nome: 'Files', aba: { hasText: 'Files' }, seletor: '.file-item', minimo: 1 },
  { nome: 'Compare', aba: { hasText: 'Compare' }, seletor: '.file-item', minimo: 1 },
  { nome: 'Branches', aba: { hasText: 'Branches' }, seletor: '.branch-item', minimo: 2 },
  { nome: 'Git log', aba: { hasText: 'Git log' }, seletor: '.gitlog-command', minimo: 1 },
  { nome: 'Dashboard', aba: null, seletor: '.dash-grid > *', minimo: 1 }
]

/** Falha do ambiente (não do app): sem Playwright ou sem Chromium o ponta a ponta não roda, e isso reprova. */
const ausente = (erro) => /playwright não encontrado|Chromium não encontrado/.test(String(erro?.message ?? erro))

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

let app
try {
  app = await newApp({ lang: 'en' })
} catch (erro) {
  if (ausente(erro)) {
    console.error('e2e indisponível: instale Playwright e Chromium (ver .claude/skills/run-gittools)')
    sair(INDISPONIVEL)
  }
  console.error(`e2e: não abriu a interface: ${erro?.stack ?? erro}`)
  sair(1)
}

const { page, backend, errors } = app
const falhas = []
let tirouPrint = false

async function registrarFalha(mensagem) {
  falhas.push(mensagem)
  console.log(`FALHA ${mensagem}`)
  if (tirouPrint) return
  tirouPrint = true
  mkdirSync(SAIDA, { recursive: true })
  await page.screenshot({ path: PRINT }).catch(() => undefined)
}

try {
  for (const tela of TELAS) {
    try {
      await (tela.aba ? page.locator('.screen-tab:not(.dashboards-tab)').filter(tela.aba).first() : page.locator('.dashboards-tab')).click({ timeout: 10_000 })
      await page.waitForFunction(([seletor, minimo]) => document.querySelectorAll(seletor).length >= minimo, [tela.seletor, tela.minimo], { timeout: 10_000 })
    } catch {
      const achados = await page.locator(tela.seletor).count().catch(() => 0)
      await registrarFalha(`${tela.nome}: esperava ao menos ${tela.minimo} de "${tela.seletor}", achou ${achados}`)
      continue
    }
    const nos = await page.evaluate(() => document.querySelectorAll('*').length)
    if (nos > LIMITE_NOS_DOM) await registrarFalha(`${tela.nome}: ${nos} nós no DOM, acima de ${LIMITE_NOS_DOM}`)
    else console.log(`OK    ${tela.nome} (${nos} nós no DOM)`)
  }

  // Erros que chegam logo depois da última tela também contam.
  await page.waitForTimeout(500)
  const erros = classificarErros(errors)
  if (!erros.ok) await registrarFalha(`erros na página: ${[...erros.reais, `${erros.naoEncontrados}× 404`].join(' | ')}`)
  else console.log(`OK    sem erros na página (${erros.naoEncontrados}× 404 do favicon)`)

  const log = await backend.invoke('app:gitLog', [])
  const inesperados = gitInesperado(log)
  if (inesperados.length) await registrarFalha(`processo git inesperado: ${inesperados.join(' | ')}`)
  else console.log(`OK    nenhum processo git inesperado (${log.length} processos)`)
} catch (erro) {
  await registrarFalha(`erro no roteiro: ${erro?.stack ?? erro}`)
} finally {
  await app.close().catch(() => undefined)
}

if (falhas.length) {
  console.error(`e2e: ${falhas.length} falha(s); print em ${PRINT}`)
  sair(1)
}
console.log('e2e: ok')
sair(0)
