// Passeio guiado pela interface (issue #98): a lista de passos, os saltos, a saída e o progresso. Lógica pura, sem
// React, para ser testada direto (tests/tour.test.ts). O cartão e o destaque ficam no componente; os textos, em
// tourText.ts. Desenho: docs/DESENHO-TOUR.md (seções 2 a 5 e 7).

import { TOP_SCREEN_IDS } from './screenVisibility'

export type TourStepId =
  | 'open'
  | 'clone'
  | 'branch'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'new'
  | 'studio'
  | 'conflicts'
  | 'settings'
  | 'screens'
  | 'history'
  | 'history-diff'
  | 'changes-commit'
  | 'changes-diff'
  | 'files'
  | 'compare'
  | 'branches'
  | 'gitlog'
  | 'dashboards'

export interface TourStep {
  id: TourStepId
  /** Seletor CSS do alvo: `[data-tour="x"]` ou `[data-view="y"]`. */
  target: string
  /** Onde o passo aparece: só sem repositório (tela de abrir), só com repositório, ou nos dois. */
  context: 'noRepo' | 'repo' | 'both'
  /** Só os passos 12 a 19: a tela (ScreenId) a abrir antes de mostrar o passo, pelo mesmo caminho do clique na aba. */
  screen?: string
  /** Nome da tela em `pref.screens.hidden` que esconde este passo. */
  hideKey?: string
}

export interface TourContext {
  hasRepo: boolean
  /** Telas escondidas em Aparência → Telas (`pref.screens.hidden`). */
  hiddenScreens: readonly string[]
}

/** Os 20 passos, na ordem de uso (tabela da seção 2 do desenho). */
export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'open', target: '[data-tour="open"]', context: 'noRepo' },
  { id: 'clone', target: '[data-tour="clone"]', context: 'noRepo' },
  { id: 'branch', target: '[data-tour="branch"]', context: 'repo' },
  { id: 'fetch', target: '[data-tour="fetch"]', context: 'repo' },
  { id: 'pull', target: '[data-tour="pull"]', context: 'repo' },
  { id: 'push', target: '[data-tour="push"]', context: 'repo' },
  { id: 'new', target: '[data-tour="new"]', context: 'repo' },
  { id: 'studio', target: '[data-tour="studio"]', context: 'repo' },
  { id: 'conflicts', target: '[data-tour="conflicts"]', context: 'repo' },
  { id: 'settings', target: '[data-tour="settings"]', context: 'both' },
  { id: 'screens', target: '[data-tour="screens"]', context: 'repo' },
  { id: 'history', target: '[data-view="history"]', context: 'repo', screen: 'history', hideKey: 'history' },
  { id: 'history-diff', target: '[data-view="commit.diff"]', context: 'repo', screen: 'history', hideKey: 'history' },
  { id: 'changes-commit', target: '[data-view="changes.commit"]', context: 'repo', screen: 'changes', hideKey: 'changes' },
  { id: 'changes-diff', target: '[data-view="changes.diff"]', context: 'repo', screen: 'changes', hideKey: 'changes' },
  { id: 'files', target: '[data-view="files.list"]', context: 'repo', screen: 'files', hideKey: 'files' },
  { id: 'compare', target: '[data-view="compare.setup"]', context: 'repo', screen: 'compare', hideKey: 'compare' },
  { id: 'branches', target: '[data-view="branches"]', context: 'repo', screen: 'branches', hideKey: 'branches' },
  { id: 'gitlog', target: '[data-view="gitlog"]', context: 'repo', screen: 'gitlog', hideKey: 'gitlog' },
  { id: 'dashboards', target: '[data-tour="dashboards"]', context: 'repo', hideKey: 'dashboards' }
]

const STEP_ID_SET = new Set<string>(TOUR_STEPS.map((s) => s.id))

/** Diz se um valor é o id de um passo do Tour (qualquer valor de fora é só texto). */
export function isTourStepId(value: unknown): value is TourStepId {
  return typeof value === 'string' && STEP_ID_SET.has(value)
}

/**
 * Passos que valem neste contexto, sem os que estão escondidos. `hidden` guarda os que saíram por tela oculta
 * (o cartão final os nomeia). O passo 11 (`screens`) sai quando todas as abas estão escondidas, porque não há
 * faixa de abas para mostrar.
 */
export function buildTourList(ctx: TourContext): { list: TourStep[]; hidden: TourStepId[] } {
  const allScreensHidden = TOP_SCREEN_IDS.every((id) => ctx.hiddenScreens.includes(id))
  const list: TourStep[] = []
  const hidden: TourStepId[] = []
  for (const step of TOUR_STEPS) {
    // Sem repositório só entram os passos da tela de abrir; com um, tudo menos a tela de abrir.
    if (ctx.hasRepo ? step.context === 'noRepo' : step.context === 'repo') continue
    const gone = step.id === 'screens' ? allScreensHidden : step.hideKey !== undefined && ctx.hiddenScreens.includes(step.hideKey)
    if (gone) hidden.push(step.id)
    else list.push(step)
  }
  return { list, hidden }
}

/** Como estava a interface ao começar: tela do dock, Dashboards aberto e tela Conflitos aberta. */
export interface TourInitial {
  view: string | null
  dashboards: boolean
  conflicts: boolean
}

export interface TourState {
  list: TourStep[]
  index: number
  /** Passos pulados por alvo ausente no DOM, sem repetição (o cartão final os lista). */
  skipped: TourStepId[]
  /** Passos que saíram por tela oculta (o cartão final os lista). */
  hidden: TourStepId[]
  hasRepo: boolean
  /** Passou do último passo. */
  done: boolean
  /** Como estava a interface antes de começar: a saída devolve isto. */
  initial: TourInitial
}

/**
 * Começa no primeiro passo que ainda não foi visto. Se todos já foram vistos, recomeça do primeiro. Não olha o
 * DOM: quem chama confere o alvo com `settle` ao mostrar o passo.
 */
export function startTour(ctx: TourContext, seen: readonly string[], initial: TourInitial): TourState {
  const { list, hidden } = buildTourList(ctx)
  const first = list.findIndex((s) => !seen.includes(s.id))
  return {
    list,
    index: first === -1 ? 0 : first,
    skipped: [],
    hidden,
    hasRepo: ctx.hasRepo,
    done: false,
    initial: { ...initial }
  }
}

/**
 * Vai ao próximo passo cujo alvo existe (avanço), ou ao anterior (recuo). Em avanço, os passos sem alvo que forem
 * passados entram em `skipped`, sem repetição. Passar do último passo termina o Tour. Recuar no primeiro não faz
 * nada. Não muda o estado recebido.
 */
export function advance(state: TourState, dir: 1 | -1, exists: (step: TourStep) => boolean): TourState {
  if (state.done) return state
  if (dir === -1) {
    for (let i = state.index - 1; i >= 0; i--) if (exists(state.list[i])) return { ...state, index: i }
    return state
  }
  const skipped = [...state.skipped]
  for (let i = state.index + 1; i < state.list.length; i++) {
    const step = state.list[i]
    if (exists(step)) return { ...state, index: i, skipped }
    if (!skipped.includes(step.id)) skipped.push(step.id)
  }
  return { ...state, skipped, done: true }
}

/**
 * Valida o passo atual antes de mostrá-lo: se o alvo não existe (a tela mudou), ele vai para `skipped` e o Tour
 * avança como em `advance`. Com o alvo presente, devolve o mesmo estado.
 */
export function settle(state: TourState, exists: (step: TourStep) => boolean): TourState {
  if (state.done) return state
  const current = state.list[state.index]
  if (exists(current)) return state
  const skipped = state.skipped.includes(current.id) ? state.skipped : [...state.skipped, current.id]
  return advance({ ...state, skipped }, 1, exists)
}

/** O que restaurar ao sair (Sair, Esc ou fim do passeio): sempre os valores de antes de começar, em qualquer passo. */
export function restoreTarget(state: TourState): TourInitial {
  return { ...state.initial }
}

/** Chave em `pref.` (layout.ts): o prefixo garante que "restaurar padrão" não apague o progresso. */
export const TOUR_SEEN_KEY = 'tour.seen'

/** Lê os ids já vistos, salvos como lista (ou como o JSON dela). Só ids conhecidos, sem repetição; o resto é ignorado. */
export function parseSeen(raw: unknown): string[] {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  const seen: string[] = []
  for (const item of value) if (isTourStepId(item) && !seen.includes(item)) seen.push(item)
  return seen
}

/** Acrescenta um passo visto, sem repetir; não altera a lista recebida. */
export function markSeen(seen: readonly string[], id: TourStepId): string[] {
  return seen.includes(id) ? [...seen] : [...seen, id]
}

/** Posição para o cartão ("3 de 20"). `current` não passa do total, mesmo depois do fim. */
export function progressOf(state: TourState): { current: number; total: number } {
  const total = state.list.length
  return { current: Math.min(state.index + 1, total), total }
}
