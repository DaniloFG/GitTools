// Arranjo das telas em áreas, como no VS Code (sem React nem DOM, para poder ser testado à parte).
//
// A janela tem quatro áreas: esquerda, centro, direita e embaixo. Cada área mostra abas; o usuário
// arrasta uma aba para outra área (ou para outra posição na mesma área) e o arranjo fica guardado.
// Áreas vazias somem da tela (a não ser o centro).

export type ViewId = 'branches' | 'history' | 'changes' | 'files' | 'compare' | 'gitlog'
export type AreaId = 'left' | 'center' | 'right' | 'bottom'

export const VIEW_IDS: readonly ViewId[] = ['branches', 'history', 'changes', 'files', 'compare', 'gitlog']
export const AREA_IDS: readonly AreaId[] = ['left', 'center', 'right', 'bottom']

export interface AreaState {
  /** Abas da área, na ordem em que aparecem. */
  views: ViewId[]
  /** Aba visível (a primeira, se ausente ou inválida). */
  active?: ViewId
}

export type WorkbenchState = Record<AreaId, AreaState>

export const DEFAULT_WORKBENCH: WorkbenchState = {
  left: { views: ['branches'] },
  center: { views: ['history', 'changes', 'files', 'compare'] },
  right: { views: [] },
  bottom: { views: ['gitlog'] }
}

/** Área onde cada tela fica no arranjo padrão (para onde volta uma tela que sumiu do arranjo salvo). */
const HOME: Record<ViewId, AreaId> = {
  branches: 'left',
  history: 'center',
  changes: 'center',
  files: 'center',
  compare: 'center',
  gitlog: 'bottom'
}

const isView = (v: unknown): v is ViewId => typeof v === 'string' && (VIEW_IDS as readonly string[]).includes(v)

/** Arranjo salvo válido: cada tela aparece exatamente uma vez; telas novas vão para a área padrão. */
export function parseWorkbench(value: unknown): WorkbenchState {
  if (!value || typeof value !== 'object') return cloneState(DEFAULT_WORKBENCH)
  const raw = value as Record<string, unknown>
  const seen = new Set<ViewId>()
  const state = {} as WorkbenchState
  for (const area of AREA_IDS) {
    const entry = raw[area] as { views?: unknown; active?: unknown } | undefined
    const views = Array.isArray(entry?.views) ? entry!.views.filter((v): v is ViewId => isView(v) && !seen.has(v) && !!seen.add(v)) : []
    state[area] = { views, ...(isView(entry?.active) && views.includes(entry!.active) ? { active: entry!.active } : {}) }
  }
  for (const view of VIEW_IDS) if (!seen.has(view)) state[HOME[view]].views.push(view)
  return state
}

function cloneState(state: WorkbenchState): WorkbenchState {
  return Object.fromEntries(AREA_IDS.map((a) => [a, { ...state[a], views: [...state[a].views] }])) as WorkbenchState
}

export function areaOf(state: WorkbenchState, view: ViewId): AreaId {
  return AREA_IDS.find((a) => state[a].views.includes(view)) ?? HOME[view]
}

/** Aba visível de uma área (ou null se a área está vazia). */
export function activeView(state: WorkbenchState, area: AreaId): ViewId | null {
  const { views, active } = state[area]
  return active && views.includes(active) ? active : (views[0] ?? null)
}

/** Torna a tela visível dentro da área dela. */
export function activate(state: WorkbenchState, view: ViewId): WorkbenchState {
  const area = areaOf(state, view)
  if (activeView(state, area) === view) return state
  const next = cloneState(state)
  next[area].active = view
  return next
}

/**
 * Move uma tela para `area`, na posição `index` (no fim, se ausente). Dentro da mesma área, o índice
 * se refere à lista antes da mudança — como o lugar onde a aba foi solta. A tela movida fica visível.
 */
export function moveView(state: WorkbenchState, view: ViewId, area: AreaId, index?: number): WorkbenchState {
  const next = cloneState(state)
  const from = areaOf(state, view)
  const oldIndex = next[from].views.indexOf(view)
  next[from].views.splice(oldIndex, 1)
  let at = index ?? next[area].views.length
  if (from === area && index !== undefined && oldIndex < index) at -= 1
  at = Math.max(0, Math.min(at, next[area].views.length))
  next[area].views.splice(at, 0, view)
  next[area].active = view
  if (from !== area && next[from].active === view) delete next[from].active
  return next
}
