// Orçamentos das fases de QA não funcional (scripts/validacao/qa.mjs). A única fonte dos tetos é
// orcamentos.json; este módulo só os lê, valida e compara com o medido. Lógica pura (sem Playwright), para o
// teste (tests/orcamentos.test.ts) cobrir sem subir Chromium.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PADRAO = fileURLToPath(new URL('./orcamentos.json', import.meta.url))

/** Número finito e não negativo: contagem ou milissegundos. */
const numeroValido = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Confere que `tetos` é um objeto não vazio de números válidos; acrescenta os problemas em `problemas`. */
function validarTetos(tetos, caminho, problemas) {
  if (!ehObjeto(tetos) || Object.keys(tetos).length === 0) {
    problemas.push(`${caminho}: tetos ausentes`)
    return
  }
  for (const [chave, valor] of Object.entries(tetos)) {
    if (!numeroValido(valor)) problemas.push(`${caminho}.${chave}: ausente ou inválido`)
  }
}

/**
 * Problemas do arquivo de orçamentos, um por frase. Lista vazia = válido. Nunca lança: quem chama decide.
 * @param {unknown} obj
 * @returns {string[]}
 */
export function validarOrcamentos(obj) {
  if (!ehObjeto(obj)) return ['orçamentos: o arquivo não é um objeto']
  const problemas = []
  if (typeof obj.origem !== 'string' || obj.origem.trim() === '') problemas.push('origem ausente')

  const r = obj.responsivo
  if (!ehObjeto(r)) {
    problemas.push('responsivo ausente')
  } else {
    if (!Array.isArray(r.larguras) || r.larguras.length === 0 || !r.larguras.every((l) => numeroValido(l) && l > 0)) problemas.push('responsivo.larguras: ausente ou inválido')
    if (!Array.isArray(r.posicoes) || r.posicoes.length === 0 || !r.posicoes.every((p) => typeof p === 'string' && p !== '')) problemas.push('responsivo.posicoes: ausente ou inválido')
    if (!numeroValido(r.altura) || r.altura === 0) problemas.push('responsivo.altura: ausente ou inválido')
  }

  const d = obj.desempenho
  if (!ehObjeto(d)) {
    problemas.push('desempenho ausente')
  } else {
    if (!numeroValido(d.cpu) || d.cpu < 1) problemas.push('desempenho.cpu: ausente ou inválido')
    if (typeof d.cenario !== 'string' || d.cenario === '') problemas.push('desempenho.cenario: ausente ou inválido')
    validarTetos(d.tetos, 'desempenho.tetos', problemas)
  }

  const t = obj.teclado
  if (!ehObjeto(t)) problemas.push('teclado ausente')
  else validarTetos(t.tetos, 'teclado.tetos', problemas)

  return problemas
}

/**
 * Lê e valida o arquivo de orçamentos. Lança com a lista de problemas: fase de QA sem teto confiável não pode
 * passar em silêncio.
 * @param {string} [caminho]
 */
export function carregarOrcamentos(caminho = PADRAO) {
  let obj
  try {
    obj = JSON.parse(readFileSync(caminho, 'utf8'))
  } catch (erro) {
    throw new Error(`orçamentos: não leu ${caminho}: ${erro?.message ?? erro}`)
  }
  const problemas = validarOrcamentos(obj)
  if (problemas.length) throw new Error(`orçamentos inválidos (${caminho}): ${problemas.join('; ')}`)
  return obj
}

/**
 * Compara o medido com os tetos. Passa no limite exato. Chave medida sem teto e teto sem medida são violações: a
 * medição que não bate com o orçamento (renomeada, esquecida) não pode passar em silêncio.
 * @param {Record<string, number>} medido
 * @param {Record<string, number>} tetos
 * @returns {string[]}
 */
export function avaliarTetos(medido, tetos) {
  const violacoes = []
  for (const [chave, valor] of Object.entries(medido)) {
    // hasOwn: `in` acharia 'constructor' e 'toString' herdados de Object.prototype e deixaria passar a chave sem teto.
    if (!Object.hasOwn(tetos, chave)) violacoes.push(`${chave}: medido sem teto`)
    else if (typeof valor !== 'number' || Number.isNaN(valor)) violacoes.push(`${chave}: medido inválido (${valor})`)
    else if (valor > tetos[chave]) violacoes.push(`${chave}: ${valor} acima do teto de ${tetos[chave]}`)
  }
  for (const chave of Object.keys(tetos)) {
    if (!Object.hasOwn(medido, chave)) violacoes.push(`${chave}: teto sem medida`)
  }
  return violacoes
}
