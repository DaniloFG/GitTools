import { useApp } from '../context'
import { inScreen, pinnedIn, SCREEN_IDS, SCREEN_VIEWS, toggleIn, type DockState, type ScreenId, type ViewId } from '../dock'
import { t } from '../i18n'
import { applySavedLayout, findByName, removeSavedLayout, saveCurrentLayout, useSavedLayouts } from '../savedLayouts'
import type { ViewMeta } from './Dock'
import type { MenuItem } from './ContextMenu'

interface Props {
  state: DockState
  onChange(next: DockState): void
  /** Menu do topo aberto agora. */
  screen: ScreenId
  /** Troca de menu (a única forma de mudar de tela). */
  onScreen(screen: ScreenId): void
  meta: Record<ViewId, ViewMeta>
  available(view: ViewId): boolean
  /** Arquivos alterados (número do botão Alterações). */
  changeCount: number
  /** A tela de Dashboards está aberta e como abri-la. */
  dashboards: boolean
  onDashboards(): void
}

/** Menus do topo, na ordem em que aparecem. */
const SCREENS: { id: ScreenId; label: Parameters<typeof t>[0] }[] = [
  { id: 'history', label: 'tabs.history' },
  { id: 'changes', label: 'tabs.changes' },
  { id: 'files', label: 'tabs.files' },
  { id: 'compare', label: 'tabs.compare' },
  { id: 'branches', label: 'workbench.views.branches' },
  { id: 'gitlog', label: 'gitlog.title' }
]

/** Nome de cada tela (o menu do topo e os submenus do menu Painéis). */
const SCREEN_NAMES: Record<ScreenId, Parameters<typeof t>[0]> = {
  branches: 'workbench.views.branches',
  history: 'tabs.history',
  changes: 'tabs.changes',
  files: 'tabs.files',
  compare: 'tabs.compare',
  gitlog: 'gitlog.title'
}

/**
 * Menus do topo. Cada um mostra só os próprios painéis; um menu com painéis de outras telas fixados nele mostra
 * a quantidade discretamente (com a lista na dica), para não se perder deles.
 */
export function ScreenTabs({ state, meta, screen, available, onScreen, changeCount, dashboards, onDashboards }: Omit<Props, 'onChange'>) {
  return (
    <div className="screen-tabs" role="group" aria-label={t('workbench.screens')} title={t('workbench.screensHelp')}>
      {SCREENS.map((item) => {
        const current = !dashboards && screen === item.id
        const pinned = pinnedIn(state, item.id).filter(available)
        return (
          <button key={item.id} className={`screen-tab ${current ? 'active' : ''}`} aria-pressed={current} onClick={() => onScreen(item.id)}>
            {t(item.label)}
            {item.id === 'changes' && changeCount > 0 && <span className="badge">{changeCount}</span>}
            {pinned.length > 0 && (
              <span className="screen-pinned" title={`${t('screenMenu.pinnedHelp', { count: pinned.length })}: ${pinned.map((v) => meta[v].label).join(', ')}`}>
                +{pinned.length}
              </span>
            )}
          </button>
        )
      })}
      <button className={`screen-tab dashboards-tab ${dashboards ? 'active' : ''}`} aria-pressed={dashboards} title={t('dash.tabHelp')} onClick={onDashboards}>
        <span aria-hidden>◔</span> {t('dash.title')}
      </button>
    </div>
  )
}

/** Menu para mostrar ou esconder painéis (os do menu aberto e os fixados de outras telas), e o layout salvo/padrão. */
export function PanelsButtons({ state, onChange, screen, meta, available }: Omit<Props, 'changeCount' | 'dashboards' | 'onDashboards' | 'onScreen'>) {
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

  /** Um painel da lista: ✓ quando está à vista nesta tela; clicar mostra ou esconde (ou fixa, se for de outra tela). */
  const panelItem = (view: ViewId): MenuItem => {
    const shown = inScreen(state, view, screen)
    return { label: `${shown ? '✓' : ' '} ${meta[view].label}`, onClick: () => onChange(toggleIn(state, view, screen)) }
  }

  const panelsMenu = (e: React.MouseEvent) => {
    const items: MenuItem[] = SCREEN_VIEWS[screen].filter(available).map(panelItem)
    // Painéis de outras telas: fixados aqui, só nesta tela (o resto do tempo ficam nas telas deles).
    const others: MenuItem[] = []
    for (const other of SCREEN_IDS) {
      if (other === screen) continue
      const views = SCREEN_VIEWS[other].filter(available)
      if (views.length) others.push({ label: t(SCREEN_NAMES[other]), submenu: views.map(panelItem) })
    }
    if (others.length) items.push('separator', { label: t('screenMenu.otherScreens'), submenu: others })
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
