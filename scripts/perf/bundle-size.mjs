// Confere o tamanho do que os dois builds geraram, contra tetos fixos. Reprova se algum passar do teto.
//
//   npm run build && npm run build:extension && npm run perf:bundle
//
// O que é medido (bytes em disco, sem compactação):
//   - interface do webview (extension/dist/webview/index.html) e do Electron (out/renderer/index.html):
//     JavaScript da primeira carga = o <script type="module" src> de entrada + os <link rel="modulepreload">
//     + o maior catálogo de idioma; CSS da primeira carga = os <link rel="stylesheet"> do mesmo index.html;
//   - processo principal (out/main/index.js) e extensão (extension/dist/extension.js).
//
// Como acha o catálogo: o Vite grava cada src/shared/i18n/messages/<idioma>.ts como <idioma>-<hash>.js em assets/.
// Os idiomas são os nomes desses arquivos (index.ts é o agrupador, não entra). O maior pedaço que começa por um
// deles conta como o catálogo; como é o maior, o teto vale para qualquer idioma ativo.
//
// Teste de que o roteiro reprova: BUNDLE_LIMIT_SCALE=0.5 multiplica todos os tetos por esse número. Serve só para
// provar que o código de saída 1 aparece. O CI nunca define essa variável.
//
// Código de saída: 0 se tudo cabe; 1 se algum item passou do teto ou se um arquivo esperado não existe (rode
// os dois builds antes). No GitHub Actions, cada estouro também sai como anotação de erro.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

/**
 * Tetos em bytes.
 * - primeiraCarga: meta da Fase 5 em docs/PERFORMANCE.md ("JavaScript da primeira carga em até 700 KB").
 * - css, processoPrincipal, extensao: tamanho atual com folga de uns 20%. Para subir um teto, mude o número aqui
 *   e explique o porquê no commit; não suba em silêncio.
 */
const TETOS = {
  primeiraCarga: 700_000,
  css: 100_000,
  processoPrincipal: 100_000,
  extensao: 100_000
}

const MENSAGEM_BUILD = 'Rode os dois builds antes: npm run build && npm run build:extension'

/** Arquivos que faltam; preenchido por tamanho() e pelas leituras do index.html. */
const faltando = []

const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Escapa a mensagem para o formato de anotação do GitHub Actions. */
const escaparAnotacao = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')

/** Todas as tags `<nome ...>` do HTML. */
const tags = (html, nome) => [...html.matchAll(new RegExp(`<${nome}\\s[^>]*>`, 'gi'))].map((m) => m[0])
/** Valor de um atributo da tag (a palavra inteira, para `src` não casar com `data-src`). */
const atributo = (tag, nome) => tag.match(new RegExp(`(?:^|\\s)${nome}=["']([^"']*)["']`, 'i'))?.[1]

/** Multiplicador dos tetos (BUNDLE_LIMIT_SCALE, só para teste). */
function escala() {
  const bruto = process.env.BUNDLE_LIMIT_SCALE
  if (bruto === undefined) return 1
  const n = Number(bruto)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`BUNDLE_LIMIT_SCALE inválida: "${bruto}" (use um número maior que zero).`)
  return n
}

/** Os idiomas: um arquivo por idioma em src/shared/i18n/messages/ (index.ts é o agrupador). */
function idiomas() {
  const pasta = join(ROOT, 'src/shared/i18n/messages')
  const ids = readdirSync(pasta)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .map((f) => f.slice(0, -'.ts'.length))
  if (ids.length === 0) throw new Error(`Nenhum catálogo de idioma em ${relative(ROOT, pasta)}.`)
  return ids
}

/** Tamanho de um arquivo; 0 e registro em `faltando` se ele não existe. */
function tamanho(caminho) {
  if (!existsSync(caminho)) {
    faltando.push(`Arquivo esperado não existe: ${relative(ROOT, caminho)}`)
    return 0
  }
  return statSync(caminho).size
}

/** O maior pedaço de catálogo em `pasta` (ou null se não há nenhum). */
function maiorCatalogo(pasta, ids) {
  if (!existsSync(pasta)) return null
  const padrao = new RegExp(`^(?:${ids.map(escapar).join('|')})-.+\\.js$`)
  return readdirSync(pasta)
    .filter((nome) => padrao.test(nome))
    .map((nome) => ({ nome, bytes: statSync(join(pasta, nome)).size }))
    .reduce((maior, atual) => (maior === null || atual.bytes > maior.bytes ? atual : maior), null)
}

/** As linhas de uma interface: JavaScript e CSS da primeira carga, lidos do index.html que o Vite gerou. */
function linhasDaInterface(rotulo, indexRel, ids) {
  const index = join(ROOT, indexRel)
  if (!existsSync(index)) {
    faltando.push(`Arquivo esperado não existe: ${indexRel}`)
    return []
  }
  const html = readFileSync(index, 'utf8')
  const pasta = dirname(index)

  const entrada = tags(html, 'script').filter((t) => atributo(t, 'type') === 'module' && atributo(t, 'src'))
  if (entrada.length !== 1) throw new Error(`${indexRel}: esperava um <script type="module" src> de entrada, achei ${entrada.length}.`)
  const srcEntrada = atributo(entrada[0], 'src')
  const bytesEntrada = tamanho(resolve(pasta, srcEntrada))

  const preloads = tags(html, 'link')
    .filter((t) => atributo(t, 'rel') === 'modulepreload')
    .map((t) => atributo(t, 'href'))
    .filter(Boolean)
  const bytesPreloads = preloads.reduce((soma, href) => soma + tamanho(resolve(pasta, href)), 0)

  const pastaAssets = join(pasta, 'assets')
  const catalogo = maiorCatalogo(pastaAssets, ids)
  if (!catalogo) faltando.push(`Nenhum catálogo de idioma em ${relative(ROOT, pastaAssets)} (esperado <idioma>-<hash>.js)`)
  const bytesCatalogo = catalogo?.bytes ?? 0

  const folhas = tags(html, 'link')
    .filter((t) => atributo(t, 'rel') === 'stylesheet')
    .map((t) => atributo(t, 'href'))
    .filter(Boolean)
  const bytesCss = folhas.reduce((soma, href) => soma + tamanho(resolve(pasta, href)), 0)

  return [
    {
      nome: `${rotulo}: JS da primeira carga`,
      bytes: bytesEntrada + bytesPreloads + bytesCatalogo,
      tetoBase: TETOS.primeiraCarga,
      subs: [
        [`entrada ${srcEntrada}`, bytesEntrada],
        [`preloads (${preloads.length})`, bytesPreloads],
        [`maior catálogo ${catalogo?.nome ?? '(nenhum)'}`, bytesCatalogo]
      ]
    },
    { nome: `${rotulo}: CSS da primeira carga`, bytes: bytesCss, tetoBase: TETOS.css, subs: [] }
  ]
}

function main() {
  const ESCALA = escala()
  const ids = idiomas()
  const brutas = [
    ...linhasDaInterface('Interface do webview', 'extension/dist/webview/index.html', ids),
    ...linhasDaInterface('Interface do Electron', 'out/renderer/index.html', ids),
    { nome: 'Processo principal (out/main/index.js)', bytes: tamanho(join(ROOT, 'out/main/index.js')), tetoBase: TETOS.processoPrincipal, subs: [] },
    { nome: 'Extensão (extension/dist/extension.js)', bytes: tamanho(join(ROOT, 'extension/dist/extension.js')), tetoBase: TETOS.extensao, subs: [] }
  ]

  if (faltando.length > 0) {
    for (const f of faltando) console.error(`ERRO: ${f}`)
    console.error(MENSAGEM_BUILD)
    process.exitCode = 1
    return
  }

  const linhas = brutas.map((l) => ({ ...l, teto: Math.floor(l.tetoBase * ESCALA) }))
  const rotulos = linhas.flatMap((l) => [l.nome, ...l.subs.map(([nome]) => `  ${nome}`)])
  const largura = Math.max(...rotulos.map((r) => r.length), 'Item'.length)

  console.log(ESCALA === 1 ? 'Tamanho do pacote (bytes)' : `Tamanho do pacote (bytes; tetos x${ESCALA}: só para teste)`)
  console.log(`${'Item'.padEnd(largura)}  ${'Bytes'.padStart(10)}  ${'Teto'.padStart(10)}  Situação`)
  for (const l of linhas) {
    const acima = l.bytes > l.teto
    console.log(`${l.nome.padEnd(largura)}  ${fmt(l.bytes).padStart(10)}  ${fmt(l.teto).padStart(10)}  ${acima ? 'ACIMA' : 'ok'}`)
    for (const [nome, bytes] of l.subs) console.log(`${`  ${nome}`.padEnd(largura)}  ${fmt(bytes).padStart(10)}`)
  }

  const estouros = linhas.filter((l) => l.bytes > l.teto)
  for (const l of estouros) {
    const msg = `${l.nome}: ${fmt(l.bytes)} bytes, teto ${fmt(l.teto)} (${fmt(l.bytes - l.teto)} a mais). Veja docs/PERFORMANCE.md antes de subir o teto.`
    console.error(`ERRO: ${msg}`)
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error title=Tamanho do pacote::${escaparAnotacao(msg)}`)
  }

  if (estouros.length > 0) {
    console.error(`Resultado: ${estouros.length} item(ns) acima do teto.`)
    process.exitCode = 1
  } else {
    console.log('Resultado: tudo dentro dos tetos.')
  }
}

try {
  main()
} catch (erro) {
  console.error(`ERRO: ${erro.message}`)
  process.exitCode = 1
}
