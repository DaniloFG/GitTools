// Lógica pura do diff em blocos (ver components/DiffView.tsx). Sem React e sem DOM, para ser testada em Node.
//
// O diff de um arquivo grande tem dezenas de milhares de linhas de tabela. Em vez de montar todas, as linhas
// viram uma lista plana (`DiffRow`) e essa lista é cortada em blocos de BLOCK_ROWS linhas: quem desenha é uma
// lista em janela de blocos, e só os blocos perto da tela existem no DOM.

import { splitRows, lineKey } from '../../shared/diffKeys'
import type { FileDiff, LineKey } from '../../shared/types'
import type { DiffLayout } from '../../shared/settings'

/** Uma linha de tabela do diff: cabeçalho de hunk, linha (cima e baixo) ou par de linhas (lado a lado). */
export type DiffRow =
  | { kind: 'hunk'; hunk: number }
  | { kind: 'line'; hunk: number; line: number }
  | { kind: 'split'; hunk: number; left: number | null; right: number | null }

/** Tipo de alteração de uma linha: é o `data-kind` da linha e a cor da régua. */
export type ChangeKind = 'add' | 'del' | 'mod'

/**
 * Linhas por bloco. Um bloco é uma tabela própria; 40 linhas de 18 px dão 720 px, o que deixa a lista medir e
 * montar poucos blocos por vez sem muitos nós no DOM.
 */
export const BLOCK_ROWS = 40

/**
 * Linhas de tabela na mesma ordem em que o diff as desenha: para cada hunk, o cabeçalho e depois cada linha
 * (cima e baixo) ou cada par de `splitRows` (lado a lado).
 */
export function buildRows(file: FileDiff, layout: DiffLayout): DiffRow[] {
  const rows: DiffRow[] = []
  file.hunks.forEach((hunk, h) => {
    rows.push({ kind: 'hunk', hunk: h })
    if (layout === 'split') {
      for (const r of splitRows(hunk)) rows.push({ kind: 'split', hunk: h, left: r.left, right: r.right })
    } else {
      hunk.lines.forEach((_, l) => rows.push({ kind: 'line', hunk: h, line: l }))
    }
  })
  return rows
}

/**
 * Faixas [start, end) de `count` itens, de `size` em `size`; `end` é exclusivo. Contagem inválida vira lista vazia
 * e tamanho inválido vira 1, para um dado ruim não travar a conta.
 */
export function chunkRows(count: number, size = BLOCK_ROWS): { start: number; end: number }[] {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  const step = Number.isFinite(size) && size >= 1 ? Math.floor(size) : 1
  const out: { start: number; end: number }[] = []
  for (let start = 0; start < n; start += step) out.push({ start, end: Math.min(n, start + step) })
  return out
}

/**
 * Tipo de alteração de uma linha: `null` para cabeçalho e contexto. Lado a lado, só o lado direito alterado é
 * 'add', só o esquerdo é 'del' e os dois são 'mod'.
 */
export function rowKind(file: FileDiff, row: DiffRow): ChangeKind | null {
  if (row.kind === 'hunk') return null
  const hunk = file.hunks[row.hunk]
  if (row.kind === 'line') {
    const kind = hunk.lines[row.line].kind
    return kind === 'context' ? null : kind
  }
  const left = row.left !== null && hunk.lines[row.left].kind !== 'context'
  const right = row.right !== null && hunk.lines[row.right].kind !== 'context'
  if (left && right) return 'mod'
  if (left) return 'del'
  if (right) return 'add'
  return null
}

/**
 * Faixas [start, end) de linhas seguidas com alteração (`rowKind` não nulo), na ordem da lista. Cada faixa é um
 * "bloco de alteração", o que a navegação ▲/▼ percorre. `end` é exclusivo e aponta para uma linha de tabela
 * (cabeçalho ou contexto, ou o fim da lista).
 */
export function changeBlocks(file: FileDiff, rows: readonly DiffRow[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  let from = -1
  rows.forEach((row, i) => {
    if (rowKind(file, row) !== null) {
      if (from < 0) from = i
    } else if (from >= 0) {
      out.push({ start: from, end: i })
      from = -1
    }
  })
  if (from >= 0) out.push({ start: from, end: rows.length })
  return out
}

/** Chaves das linhas alteradas que a linha carrega: a da linha, ou as dos dois lados que não forem contexto. */
export function rowKeys(file: FileDiff, row: DiffRow): LineKey[] {
  if (row.kind === 'hunk') return []
  const hunk = file.hunks[row.hunk]
  if (row.kind === 'line') return hunk.lines[row.line].kind === 'context' ? [] : [lineKey(row.hunk, row.line)]
  const keys: LineKey[] = []
  if (row.left !== null && hunk.lines[row.left].kind !== 'context') keys.push(lineKey(row.hunk, row.left))
  if (row.right !== null && hunk.lines[row.right].kind !== 'context') keys.push(lineKey(row.hunk, row.right))
  return keys
}

/** Teto da largura do código sem quebra (em caracteres): uma linha minificada de megabytes não vira uma tabela gigante. */
const CODE_CH_MAX = 5000

/**
 * Comprimento, em caracteres, da maior linha de código do arquivo, para dar às tabelas sem quebra uma largura
 * única (`--code-ch`). Uma passada pelos dados do arquivo, feita só quando a quebra está desligada. O tab conta
 * como 8 colunas (o `tab-size` padrão) e há uma folga para o marcador de "sem quebra de linha no fim". Texto
 * além do teto, ou mais largo que o cálculo (ex.: ideogramas), só transborda da tabela e continua rolável.
 */
export function longestCodeChars(hunks: FileDiff['hunks']): number {
  let max = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      const text = line.content
      let width = text.length
      for (let at = text.indexOf('\t'); at !== -1; at = text.indexOf('\t', at + 1)) width += 7
      if (width > max) max = width
    }
  }
  return Math.min(max + 2, CODE_CH_MAX)
}
