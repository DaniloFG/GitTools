import { lazy, type ComponentType } from 'react'
import type { CompareRequest } from './context'

// Telas, diálogos e editores que não aparecem na abertura. Cada um vira um pedaço do pacote, baixado na primeira
// vez que é desenhado (regra "Componente de tela que não aparece na abertura é carregado sob demanda" do CLAUDE.md).
//
// Este módulo não pode importar nenhuma dessas telas de forma estática: um import estático as manteria no pacote
// inicial, por mais que o componente só seja usado num `lazy`. Por isso aqui só há `import()`.

/**
 * Envolve um import dinâmico de um componente. `C` é o tipo do componente (o do próprio módulo), o que dispensa
 * inferir as props pelo `lazy`. O `lazy` devolve um componente de outro tipo, por isso o cast.
 */
function screen<C extends ComponentType<any>>(load: () => Promise<{ default: C }>): C {
  return lazy(load) as unknown as C
}

/** Props dos painéis: `locale` entra só para o `memo` do painel ver a troca de idioma (ver `paneMemo` em App.tsx). */
interface PaneProps {
  locale: string
}

export const Dashboards = screen<ComponentType<PaneProps>>(() => import('./components/Dashboards').then((m) => ({ default: m.Dashboards })))
export const ConflictsScreen = screen<ComponentType<PaneProps>>(() => import('./components/ConflictsScreen').then((m) => ({ default: m.ConflictsScreen })))
export const CompareView = screen<ComponentType<PaneProps & { request: CompareRequest; onRequest(request: CompareRequest): void }>>(() =>
  import('./components/CompareView').then((m) => ({ default: m.CompareView }))
)
export const FileEditor = screen(() => import('./components/FileEditor').then((m) => ({ default: m.FileEditor })))
export const GitTerminal = screen(() => import('./components/GitTerminal').then((m) => ({ default: m.GitTerminal })))
export const CherryPickStudio = screen(() => import('./components/CherryPickStudio').then((m) => ({ default: m.CherryPickStudio })))
export const ConflictEditor = screen(() => import('./components/ConflictEditor').then((m) => ({ default: m.ConflictEditor })))
export const RebaseEditor = screen(() => import('./components/RebaseEditor').then((m) => ({ default: m.RebaseEditor })))
export const CloneDialog = screen(() => import('./components/CloneDialog').then((m) => ({ default: m.CloneDialog })))
export const DialogHost = screen(() => import('./components/Dialogs').then((m) => ({ default: m.DialogHost })))
export const SettingsCenter = screen(() => import('./components/settings/SettingsCenter').then((m) => ({ default: m.SettingsCenter })))
export const ShortcutsHelp = screen(() => import('./components/settings/ShortcutsHelp').then((m) => ({ default: m.ShortcutsHelp })))
export const Tour = screen(() => import('./components/Tour').then((m) => ({ default: m.Tour })))
export const DiffWindowApp = screen(() => import('./components/DiffWindow').then((m) => ({ default: m.DiffWindowApp })))

/**
 * Pede o pedaço do Dashboards antes de ele ser aberto (ao passar o mouse sobre o botão). Não pré-carrega as demais:
 * cada pedaço custa uma leitura do disco, e só vale a pena quando há um gatilho claro. Erro fica para a abertura.
 */
export function preloadDashboards(): void {
  void import('./components/Dashboards').catch(() => undefined)
}
