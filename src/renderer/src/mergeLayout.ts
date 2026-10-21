// Arranjo dos painéis do editor de conflitos (sem React, para poder ser testado à parte).
//
// Há três painéis — versão atual (ours), resultado e versão que entra (theirs) — e duas visões:
//  - "classic": dois painéis em cima, lado a lado, e o terceiro embaixo (o resultado, por padrão);
//  - "columns": os três lado a lado (como no SmartGit), na ordem que o usuário quiser.
// O usuário pode arrastar os painéis para trocá-los de lugar. As setas dos botões ("usar esta →") e os
// atalhos "pegar da esquerda/direita" são calculados a partir da posição real de cada painel na tela.

export type MergePane = 'ours' | 'result' | 'theirs'
/** As duas versões de onde o texto pode vir. */
export type MergeSource = Exclude<MergePane, 'result'>
export type MergeMode = 'classic' | 'columns'

export interface MergeLayout {
  mode: MergeMode
  /**
   * Ordem dos painéis. Em "columns": da esquerda para a direita. Em "classic": em cima à esquerda,
   * em cima à direita e embaixo.
   */
  order: MergePane[]
}

export const MERGE_PANES: MergePane[] = ['ours', 'result', 'theirs']
export const DEFAULT_ORDER: Record<MergeMode, MergePane[]> = {
  columns: ['ours', 'result', 'theirs'],
  classic: ['ours', 'theirs', 'result']
}
export const DEFAULT_MERGE_LAYOUT: MergeLayout = { mode: 'columns', order: DEFAULT_ORDER.columns }

const isOrder = (value: unknown): value is MergePane[] =>
  Array.isArray(value) && value.length === 3 && MERGE_PANES.every((p) => value.includes(p))

export function parseMergeLayout(value: unknown): MergeLayout {
  if (!value || typeof value !== 'object') return DEFAULT_MERGE_LAYOUT
  const raw = value as Record<string, unknown>
  const mode: MergeMode = raw.mode === 'classic' ? 'classic' : 'columns'
  return { mode, order: isOrder(raw.order) ? [...raw.order] : DEFAULT_ORDER[mode] }
}

/** Troca de visão; cada visão começa no arranjo padrão dela. */
export function withMode(layout: MergeLayout, mode: MergeMode): MergeLayout {
  return layout.mode === mode ? layout : { mode, order: DEFAULT_ORDER[mode] }
}

/** Troca dois painéis de lugar (ex.: ao soltar um painel arrastado sobre outro). */
export function swapPanes(layout: MergeLayout, a: MergePane, b: MergePane): MergeLayout {
  const order = [...layout.order]
  const i = order.indexOf(a)
  const j = order.indexOf(b)
  if (i < 0 || j < 0 || i === j) return layout
  ;[order[i], order[j]] = [order[j], order[i]]
  return { ...layout, order }
}

export interface PanePosition {
  /** Posição horizontal na tela (0 = esquerda). */
  x: number
  /** Posição vertical na tela (0 = em cima). */
  y: number
}

/** Onde o painel aparece na tela. Em idiomas da direita para a esquerda, as colunas ficam espelhadas. */
export function panePosition(layout: MergeLayout, pane: MergePane, rtl = false): PanePosition {
  const index = layout.order.indexOf(pane)
  let pos: PanePosition
  if (layout.mode === 'columns') pos = { x: index, y: 0 }
  else pos = index === 2 ? { x: 0.5, y: 1 } : { x: index, y: 0 }
  const maxX = layout.mode === 'columns' ? 2 : 1
  return rtl ? { x: maxX - pos.x, y: pos.y } : pos
}

/** Seta que aponta de um painel para outro, conforme a posição deles na tela. */
export function arrowBetween(layout: MergeLayout, from: MergePane, to: MergePane, rtl = false): string {
  const a = panePosition(layout, from, rtl)
  const b = panePosition(layout, to, rtl)
  const dx = Math.sign(b.x - a.x)
  const dy = Math.sign(b.y - a.y)
  const arrows: Record<string, string> = {
    '-1,0': '←',
    '1,0': '→',
    '0,-1': '↑',
    '0,1': '↓',
    '-1,-1': '↖',
    '1,-1': '↗',
    '-1,1': '↙',
    '1,1': '↘'
  }
  return arrows[`${dx},${dy}`] ?? '•'
}

/**
 * As duas versões de origem (atual e que entra) ordenadas pela posição na tela: a primeira é a que está
 * mais à esquerda. É o que os atalhos "pegar da esquerda" e "pegar da direita" usam.
 */
export function sourcesByPosition(layout: MergeLayout, rtl = false): [MergeSource, MergeSource] {
  const sources: MergeSource[] = ['ours', 'theirs']
  const [a, b] = sources.map((p) => ({ p, ...panePosition(layout, p, rtl) }))
  const left = a.x !== b.x ? (a.x < b.x ? a : b) : a.y <= b.y ? a : b
  return left === a ? [a.p, b.p] : [b.p, a.p]
}

/**
 * Próximo conflito a visitar a partir de `current` (-1 = nenhum), sempre na ordem do arquivo (de cima
 * para baixo), qualquer que seja o arranjo dos painéis. Sem `onlyPending`, para no primeiro/último
 * (retorna null). Com `onlyPending`, procura o próximo ainda não resolvido, dando a volta no arquivo.
 */
export function nextConflict(current: number, total: number, step: 1 | -1, resolved: (index: number) => boolean = () => false, onlyPending = false): number | null {
  if (total <= 0) return null
  if (!onlyPending) {
    const i = current < 0 ? (step > 0 ? 0 : total - 1) : current + step
    return i >= 0 && i < total ? i : null
  }
  const start = current < 0 ? (step > 0 ? -1 : total) : current
  for (let n = 1; n <= total; n++) {
    const i = (((start + step * n) % total) + total) % total
    if (!resolved(i)) return i
  }
  return null
}
