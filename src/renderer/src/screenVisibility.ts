// Telas do topo (History, Changes…) que o usuário pode mostrar ou esconder (menu ⚙ → Aparência → Telas).
// Só a lógica pura fica aqui, para ser testada; o que é desenhado está em components/Screens.tsx e Toolbar.tsx.

import type { MessageKey } from '../../shared/i18n'
import type { ScreenId } from './dock'

/** As telas do topo: as de painel (ScreenId) e o Dashboards, que não é uma tela do dock. */
export type TopScreenId = ScreenId | 'dashboards'

/**
 * Ids das telas do topo, na ordem em que aparecem na barra. Settings e Sponsor não entram: estão sempre à vista.
 * Quando uma tela nova entra no dock, ela precisa entrar aqui também (o teste confere isso).
 */
export const TOP_SCREEN_IDS: readonly TopScreenId[] = ['history', 'changes', 'files', 'compare', 'branches', 'gitlog', 'dashboards']

/** Nome de cada tela no menu (mesmas chaves das outras partes da interface). */
export const TOP_SCREEN_LABELS: Record<TopScreenId, MessageKey> = {
  history: 'tabs.history',
  changes: 'tabs.changes',
  files: 'tabs.files',
  compare: 'tabs.compare',
  branches: 'workbench.views.branches',
  gitlog: 'gitlog.title',
  dashboards: 'dash.title'
}

/** Lê o valor salvo: só ids conhecidos, sem repetição e na ordem da barra. O que não for válido é ignorado. */
export function parseHiddenScreens(value: unknown): TopScreenId[] {
  if (!Array.isArray(value)) return []
  const known = new Set<string>(TOP_SCREEN_IDS)
  const hidden = new Set(value.filter((v): v is string => typeof v === 'string' && known.has(v)))
  return TOP_SCREEN_IDS.filter((id) => hidden.has(id))
}

/**
 * Uma aba está à vista quando não está escondida OU é a tela aberta agora. A tela aberta nunca some: sem ela,
 * o atalho e a tela inicial ficariam apontando para algo que não está na barra.
 */
export function isScreenShown(hidden: readonly TopScreenId[], id: TopScreenId, current: TopScreenId): boolean {
  return id === current || !hidden.includes(id)
}

/** Inverte a preferência de uma tela (mesmo a aberta pode ser marcada como escondida); a lista volta na ordem da barra. */
export function toggleScreen(hidden: readonly TopScreenId[], id: TopScreenId): TopScreenId[] {
  const next = hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id]
  return parseHiddenScreens(next)
}
