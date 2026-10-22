// Disposição da aba Alterações: painéis (listas, commit, diff) em colunas que o usuário reorganiza.
// Sem React nem DOM, para poder ser testado à parte.

export type SectionId = 'conflicts' | 'unstaged' | 'staged' | 'files' | 'commit' | 'diff'

/** As duas visões: listas separadas (staged / não staged) ou uma lista com caixas de seleção. */
export type ChangesMode = 'stage' | 'check'

export const parseChangesMode = (value: unknown): ChangesMode => (value === 'check' ? 'check' : 'stage')

/** Painéis de cada visão, na ordem padrão. */
export const SECTIONS_BY_MODE: Record<ChangesMode, readonly SectionId[]> = {
  stage: ['conflicts', 'unstaged', 'staged', 'commit', 'diff'],
  check: ['conflicts', 'files', 'commit', 'diff']
}

export interface ChangesLayout {
  /** Colunas, da esquerda para a direita; cada uma lista seus painéis de cima para baixo. */
  columns: SectionId[][]
  /** Altura relativa de cada painel dentro da coluna (só vale para os que dividem o espaço). */
  weights: Partial<Record<SectionId, number>>
  /** Largura relativa de cada coluna; vazio = padrão. */
  widths: number[]
}

/** Altura relativa padrão dos painéis que dividem o espaço da coluna. */
export const DEFAULT_WEIGHTS: Partial<Record<SectionId, number>> = { conflicts: 0.7, unstaged: 1.2, staged: 1, files: 2, diff: 1 }
export const DEFAULT_WIDTHS = [0.42, 0.58]

export const weightOf = (layout: ChangesLayout, id: SectionId) => layout.weights[id] ?? DEFAULT_WEIGHTS[id] ?? 1

/** Tudo numa coluna, menos o diff, que fica numa coluna só dele ao lado. */
export function defaultLayout(mode: ChangesMode): ChangesLayout {
  return { columns: [SECTIONS_BY_MODE[mode].filter((id) => id !== 'diff'), ['diff']], weights: {}, widths: [] }
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/**
 * Valida a disposição guardada: só painéis da visão, sem repetição; os que faltarem voltam ao lugar
 * padrão (o diff numa coluna própria, os demais na primeira) e colunas vazias somem.
 */
export function parseChangesLayout(value: unknown, mode: ChangesMode): ChangesLayout {
  const valid = new Set<SectionId>(SECTIONS_BY_MODE[mode])
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const seen = new Set<SectionId>()
  const columns: SectionId[][] = []
  if (Array.isArray(raw.columns)) {
    for (const col of raw.columns) {
      if (!Array.isArray(col)) continue
      const ids: SectionId[] = []
      for (const id of col) {
        if (typeof id !== 'string' || !valid.has(id as SectionId) || seen.has(id as SectionId)) continue
        seen.add(id as SectionId)
        ids.push(id as SectionId)
      }
      if (ids.length) columns.push(ids)
    }
  }
  const missing = SECTIONS_BY_MODE[mode].filter((id) => !seen.has(id))
  if (!columns.length) return defaultLayout(mode)
  for (const id of missing) {
    if (id === 'diff') columns.push(['diff'])
    else columns[0].push(id)
  }
  const weights: ChangesLayout['weights'] = {}
  if (raw.weights && typeof raw.weights === 'object') {
    for (const id of valid) {
      const w = (raw.weights as Record<string, unknown>)[id]
      if (isNumber(w)) weights[id] = w
    }
  }
  const widths = Array.isArray(raw.widths) && raw.widths.length === columns.length && raw.widths.every(isNumber) ? (raw.widths as number[]) : []
  return { columns, weights, widths }
}

/** Onde um painel arrastado seria solto: antes/depois de outro, ou numa coluna nova na borda. */
export type DropTarget = { kind: 'section'; id: SectionId; where: 'before' | 'after' } | { kind: 'edge'; side: 'start' | 'end' }

/** Move um painel; colunas que ficam vazias somem e, se o número de colunas muda, as larguras voltam ao padrão. */
export function moveSection(layout: ChangesLayout, id: SectionId, target: DropTarget): ChangesLayout {
  if (target.kind === 'section' && target.id === id) return layout
  const without = layout.columns.map((col) => col.filter((s) => s !== id))
  let columns: SectionId[][]
  if (target.kind === 'edge') {
    columns = target.side === 'start' ? [[id], ...without] : [...without, [id]]
  } else {
    const ci = without.findIndex((col) => col.includes(target.id))
    if (ci < 0) return layout
    columns = without.map((col) => [...col])
    const at = columns[ci].indexOf(target.id) + (target.where === 'after' ? 1 : 0)
    columns[ci].splice(at, 0, id)
  }
  columns = columns.filter((col) => col.length > 0)
  const same = columns.length === layout.columns.length && target.kind === 'section' && without.every((col) => col.length > 0)
  return { ...layout, columns, widths: same ? layout.widths : [] }
}

export type MoveStep = 'up' | 'down' | 'left' | 'right'

/** Passos do menu (para quem não arrasta): sobe/desce na coluna ou muda de coluna, com borda criando uma nova. */
export function moveByStep(layout: ChangesLayout, id: SectionId, step: MoveStep): ChangesLayout {
  const ci = layout.columns.findIndex((col) => col.includes(id))
  if (ci < 0) return layout
  const col = layout.columns[ci]
  const i = col.indexOf(id)
  if (step === 'up') return i > 0 ? moveSection(layout, id, { kind: 'section', id: col[i - 1], where: 'before' }) : layout
  if (step === 'down') return i < col.length - 1 ? moveSection(layout, id, { kind: 'section', id: col[i + 1], where: 'after' }) : layout
  const nci = ci + (step === 'left' ? -1 : 1)
  const neighbour = layout.columns[nci]
  if (neighbour) {
    // Entra na outra coluna na altura equivalente.
    const at = Math.min(neighbour.length - 1, i)
    return moveSection(layout, id, { kind: 'section', id: neighbour[at], where: 'before' })
  }
  // Já está na última coluna desse lado: se não estiver sozinho, vira uma coluna nova.
  return col.length > 1 ? moveSection(layout, id, { kind: 'edge', side: step === 'left' ? 'start' : 'end' }) : layout
}

/**
 * Divide o espaço de dois painéis vizinhos ao arrastar a divisória entre eles: `sizeA` e `sizeB` são os
 * tamanhos atuais em pixels, `delta` o quanto a divisória andou; os pesos continuam somando o mesmo.
 */
export function resizePair(weightA: number, weightB: number, sizeA: number, sizeB: number, delta: number, minA: number, minB: number): [number, number] {
  const pair = sizeA + sizeB
  if (pair <= 0) return [weightA, weightB]
  const low = Math.min(minA, pair / 2)
  const high = pair - Math.min(minB, pair / 2)
  const a = Math.min(Math.max(sizeA + delta, low), high)
  const total = weightA + weightB
  return [(a / pair) * total, ((pair - a) / pair) * total]
}

/** Painéis que existem agora (ex.: sem conflitos o painel some), mantendo a ordem; colunas vazias saem. */
export function visibleColumns(layout: ChangesLayout, present: ReadonlySet<SectionId>): SectionId[][] {
  return layout.columns.map((col) => col.filter((id) => present.has(id))).filter((col) => col.length > 0)
}
