// Cálculos dos painéis redimensionáveis (sem React, para poderem ser testados à parte).

export type CollapsedPane = 'first' | 'second'

/** Estado guardado de uma divisória: tamanho do primeiro painel e qual painel está recolhido. */
export interface SplitState {
  /** Fração (0–1) do espaço ou pixels, conforme o painel. Ausente = tamanho padrão. */
  size?: number
  collapsed?: CollapsedPane
  /** Painéis trocados de lugar (o segundo aparece antes do primeiro). */
  swapped?: boolean
  /** Direção escolhida pelo usuário (lado a lado ou um em cima do outro); ausente = padrão. */
  direction?: SplitDirection
}

export type SplitDirection = 'row' | 'column'

export function parseSplitState(value: unknown): SplitState {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  const state: SplitState = {}
  if (typeof raw.size === 'number' && Number.isFinite(raw.size) && raw.size >= 0) state.size = raw.size
  if (raw.collapsed === 'first' || raw.collapsed === 'second') state.collapsed = raw.collapsed
  if (raw.swapped === true) state.swapped = true
  if (raw.direction === 'row' || raw.direction === 'column') state.direction = raw.direction
  return state
}

/**
 * Limita o tamanho do primeiro painel para que os dois respeitem seus mínimos.
 * Se não há espaço para os dois mínimos, divide o espaço na proporção deles (nada fica preso
 * ou cortado quando a janela é pequena).
 */
export function clampSize(size: number, available: number, minFirst: number, minSecond: number): number {
  if (available <= 0) return Math.max(0, size)
  if (available < minFirst + minSecond) return (available * minFirst) / (minFirst + minSecond)
  return Math.min(Math.max(size, minFirst), available - minSecond)
}

export interface DragLimits {
  available: number
  min: [number, number]
  collapsible: [boolean, boolean]
  /** Guarda pixels (true) ou fração do espaço (false). */
  fixed: boolean
}

/** Novo estado ao soltar a divisória na posição `pos` (pixels a partir do início do primeiro painel). */
export function stateFromPosition(pos: number, previous: SplitState, limits: DragLimits): SplitState {
  const { available, min, collapsible, fixed } = limits
  // Arrastar além da metade do mínimo recolhe o painel (se ele puder ser recolhido).
  if (collapsible[0] && pos < min[0] / 2) return { ...previous, collapsed: 'first' }
  if (collapsible[1] && pos > available - min[1] / 2) return { ...previous, collapsed: 'second' }
  const px = clampSize(pos, available, min[0], min[1])
  // Mantém o arranjo (troca de lugar e direção); só o tamanho muda e o painel deixa de estar recolhido.
  const { collapsed: _collapsed, ...arrangement } = previous
  return { ...arrangement, size: fixed ? Math.round(px) : available > 0 ? px / available : previous.size }
}

/** Troca os dois painéis de lugar. */
export function swapSplit(state: SplitState): SplitState {
  const { swapped, ...rest } = state
  return swapped ? rest : { ...rest, swapped: true }
}

/** Alterna entre lado a lado e um em cima do outro. */
export function rotateSplit(state: SplitState, defaultDirection: SplitDirection): SplitState {
  const direction: SplitDirection = (state.direction ?? defaultDirection) === 'row' ? 'column' : 'row'
  const { direction: _previous, ...rest } = state
  return direction === defaultDirection ? rest : { ...rest, direction }
}

/**
 * Divisórias perpendiculares que se cruzam (ou se encostam) num ponto: arrastar ali move as duas,
 * como no VS Code. `rects` são os retângulos das outras divisórias, com a orientação de cada uma.
 */
export function crossingAt<T>(
  x: number,
  y: number,
  vertical: boolean,
  others: { item: T; vertical: boolean; left: number; top: number; right: number; bottom: number }[],
  tolerance = 6
): T[] {
  return others
    .filter((o) => o.vertical !== vertical)
    .filter((o) => x >= o.left - tolerance && x <= o.right + tolerance && y >= o.top - tolerance && y <= o.bottom + tolerance)
    .map((o) => o.item)
}

/** Ajusta as larguras (em fr) de duas colunas vizinhas ao arrastar a borda entre elas. */
export function resizeColumns(start: number[], index: number, deltaFr: number, minFr: number): number[] {
  const next = [...start]
  const pair = start[index] + start[index + 1]
  const first = Math.min(Math.max(start[index] + deltaFr, minFr), pair - minFr)
  next[index] = first
  next[index + 1] = pair - first
  return next
}

export function parseColumns(value: unknown, count: number): number[] | null {
  return Array.isArray(value) && value.length === count && value.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)
    ? (value as number[])
    : null
}
