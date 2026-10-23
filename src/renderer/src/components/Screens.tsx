import { useApp } from '../context'
import { SCREEN_VIEWS, screenShown, showScreen, toggleView, type DockState, type ScreenId, type ViewId } from '../dock'
import { t } from '../i18n'
import { applySavedLayout, findByName, removeSavedLayout, saveCurrentLayout, useSavedLayouts } from '../savedLayouts'
import type { ViewMeta } from './Dock'
import type { MenuItem } from './ContextMenu'

interface Props {
  state: DockState
  onChange(next: DockState): void
  meta: Record<ViewId, ViewMeta>
  available(view: ViewId): boolean
  /** Arquivos alterados (número do botão Alterações). */
  changeCount: number
  /** A tela de Dashboards está aberta e como abri-la. */
  dashboards: boolean
  onDashboards(): void
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
export function ScreenTabs({ state, onChange, available, changeCount, dashboards, onDashboards }: Omit<Props, 'meta'>) {
  return (
    <div className="screen-tabs" role="group" aria-label={t('workbench.screens')} title={t('workbench.screensHelp')}>
      {SCREENS.map((screen) => {
        const current = !dashboards && screenShown(state, screen.id, available)
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
      <button className={`screen-tab dashboards-tab ${dashboards ? 'active' : ''}`} aria-pressed={dashboards} title={t('dash.tabHelp')} onClick={onDashboards}>
        <span aria-hidden>◔</span> {t('dash.title')}
      </button>
    </div>
  )
}

/** Menu para mostrar ou esconder qualquer painel, e o botão de restaurar o layout. */
export function PanelsButtons({ state, onChange, meta, available }: Omit<Props, 'changeCount' | 'dashboards' | 'onDashboards'>) {
  const { showMenu, resetLayout, prompt, confirm, toast } = useApp()
  const [saved, setSaved] = useSavedLayouts()

  /** Guarda o arranjo de agora com o nome que o usuário escolher (o mesmo nome substitui o layout antigo). */
  const saveLayout = async () => {
    const name = await prompt({ title: t('layouts.saveTitle'), label: t('layouts.name'), placeholder: t('layouts.namePlaceholder'), confirmLabel: t('layouts.save') })
    if (!name) return
    const existing = findByName(saved, name)
    if (existing) {
      const ok = await confirm({ title: t('layouts.replaceTitle'), message: t('layouts.replaceMessage', { name: existing.name }), confirmLabel: t('layouts.replace') })
      if (!ok) return
    }
    saveCurrentLayout(saved, setSaved, name)
    toast('success', t('layouts.saved', { name: existing?.name ?? name }))
  }

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
    items.push('separator', { label: t('layouts.saveCurrent'), onClick: () => void saveLayout() })
    if (saved.length) {
      items.push({
        label: t('layouts.mine'),
        submenu: saved.map((layout) => ({
          label: layout.name,
          onClick: () => {
            applySavedLayout(layout)
            toast('success', t('layouts.applied', { name: layout.name }))
          },
          actions: [{ icon: '✕', title: t('layouts.delete'), onClick: () => setSaved(removeSavedLayout(saved, layout.id)) }]
        }))
      })
    }
    items.push({ label: t('workbench.resetLayout'), onClick: () => void resetLayout() })
    showMenu(e, items)
  }

  return (
    <>
      <button className="icon-button panels-button" onClick={panelsMenu} title={`${t('workbench.panels')}: ${t('workbench.panelsHelp')}`} aria-label={t('workbench.panels')} aria-haspopup="menu">
        ▦
      </button>
    </>
  )
}
