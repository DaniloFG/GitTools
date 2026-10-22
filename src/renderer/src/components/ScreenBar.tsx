import { useApp } from '../context'
import { SCREEN_VIEWS, screenShown, showScreen, toggleView, type DockState, type ScreenId, type ViewId } from '../dock'
import { t } from '../i18n'
import type { ViewMeta } from './Dock'
import type { MenuItem } from './ContextMenu'

interface Props {
  state: DockState
  onChange(next: DockState): void
  meta: Record<ViewId, ViewMeta>
  available(view: ViewId): boolean
  /** Arquivos alterados (número do botão Alterações). */
  changeCount: number
}

/** Telas com botão próprio (os painéis soltos, como Branches e o Log do git, ficam no menu Painéis). */
const SCREENS: { id: ScreenId; label: Parameters<typeof t>[0] }[] = [
  { id: 'history', label: 'tabs.history' },
  { id: 'changes', label: 'tabs.changes' },
  { id: 'files', label: 'tabs.files' },
  { id: 'compare', label: 'tabs.compare' }
]

/** Nome do grupo de painéis de uma tela, no menu Painéis. */
const SCREEN_NAMES: Record<ScreenId, Parameters<typeof t>[0]> = {
  branches: 'workbench.views.branches',
  history: 'tabs.history',
  changes: 'tabs.changes',
  files: 'tabs.files',
  compare: 'tabs.compare',
  gitlog: 'gitlog.title'
}

/**
 * Atalhos para trazer à frente os painéis de uma tela (Histórico, Alterações, Arquivos, Comparar). Os painéis em
 * si não pertencem a nenhuma tela: ficam onde você os deixar, e cada um pode ser movido para qualquer lugar.
 */
export function ScreenTabs({ state, onChange, available, changeCount }: Omit<Props, 'meta'>) {
  return (
    <div className="screen-tabs" role="group" aria-label={t('workbench.screens')} title={t('workbench.screensHelp')}>
      {SCREENS.map((screen) => {
        const current = screenShown(state, screen.id, available)
        return (
          <button
            key={screen.id}
            className={`screen-tab ${current ? 'active' : ''}`}
            aria-pressed={current}
            onClick={() => onChange(showScreen(state, screen.id, available))}
          >
            {t(screen.label)}
            {screen.id === 'changes' && changeCount > 0 && <span className="badge">{changeCount}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Menu para mostrar ou esconder qualquer painel, e o botão de restaurar o layout. */
export function PanelsButtons({ state, onChange, meta, available }: Omit<Props, 'changeCount'>) {
  const { showMenu, resetLayout } = useApp()

  const panelsMenu = (e: React.MouseEvent) => {
    const items: MenuItem[] = []
    for (const screen of Object.keys(SCREEN_VIEWS) as ScreenId[]) {
      const views = SCREEN_VIEWS[screen].filter(available)
      if (views.length === 0) continue
      if (items.length) items.push('separator')
      for (const view of views) {
        const shown = !state.hidden.includes(view)
        items.push({
          label: `${shown ? '✓' : '\u2003'} ${meta[view].label}`,
          hint: SCREEN_VIEWS[screen].length > 1 ? t(SCREEN_NAMES[screen]) : undefined,
          onClick: () => onChange(toggleView(state, view))
        })
      }
    }
    items.push('separator', { label: t('workbench.resetLayout'), onClick: () => void resetLayout() })
    showMenu(e, items)
  }

  return (
    <>
      <button className="ghost" onClick={panelsMenu} title={t('workbench.panelsHelp')} aria-haspopup="menu">
        ▦ {t('workbench.panels')} ▾
      </button>
    </>
  )
}
