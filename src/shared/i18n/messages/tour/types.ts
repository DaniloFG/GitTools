// Textos do Tour (issue #98). As chaves ficam aqui, e não importadas de renderer/src/tour, para o catálogo
// não depender do renderer. Cada idioma em tour/<idioma>.ts cobre tudo; o typecheck reprova catálogo incompleto.
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

export interface TourMessages {
  step: Record<TourStepId, string>
  card: {
    previous: string
    next: string
    exit: string
    finish: string
    progress: string
    skippedTitle: string
    noRepoEnd: string
    hiddenTitle: string
    title: string
  }
}
