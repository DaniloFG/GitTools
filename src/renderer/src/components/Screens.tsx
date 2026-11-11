import { useEffect, useRef } from 'react'
import { useAppActions } from '../context'
import { inScreen, pinnedIn, SCREEN_IDS, SCREEN_VIEWS, toggleIn, type DockState, type ScreenId, type ViewId } from '../dock'
import { t } from '../i18n'
import { applySavedLayout, deleteSavedLayout, findByName, saveCurrentLayout, useCurrentLayoutName, useSavedLayouts } from '../savedLayouts'
import type { ViewMeta } from './Dock'
import type { MenuItem } from './ContextMenu'

export interface ScreenProps {
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
export function ScreenTabs({ state, meta, screen, available, onScreen, changeCount, dashboards, onDashboards }: Omit<ScreenProps, 'onChange'>) {
  const ref = useRef<HTMLDivElement>(null)
  /** Atualiza a máscara das bordas: some do lado em que não há mais abas escondidas. */
  const fade = useRef<() => void>(() => {})

  // Quando a tela muda (ou o menu ativo), a aba ativa rola para a vista em janelas estreitas.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.screen-tab.active')?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
  }, [screen, dashboards])

  // Depois de cada renderização (contagens e fixados mudam a largura), a máscara acompanha o conteúdo.
  useEffect(() => fade.current())

  useEffect(() => {
    const el = ref.current
    if (!el) return
    fade.current = () => {
      const max = el.scrollWidth - el.clientWidth
      const pos = Math.abs(el.scrollLeft)
      // Em RTL o rolar começa à direita: o lado "início" visual é o fim lógico.
      const rtl = getComputedStyle(el).direction === 'rtl'
      const atStart = pos < 2
      const atEnd = pos > max - 2
      const more = max <= 0 ? [] : [rtl ? !atEnd && 'left' : !atStart && 'left', rtl ? !atStart && 'right' : !atEnd && 'right'].filter(Boolean)
      if (more.length) el.dataset.more = more.join(' ')
      else delete el.dataset.more
    }
    fade.current()
    el.addEventListener('scroll', fade.current, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fade.current)
    observer?.observe(el)
    return () => {
      el.removeEventListener('scroll', fade.current)
      observer?.disconnect()
    }
  }, [])

  return (
    <div ref={ref} className="screen-tabs" role="group" aria-label={t('workbench.screens')} title={t('workbench.screensHelp')}>
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

/**
 * Itens do menu de painéis (mostrar ou esconder painéis da tela, painéis fixados de outras telas, layouts salvos e
 * restaurar o padrão). Fica no menu único ⚙/☰ da barra, em Aparência.
 */
export function usePanelsItems({ state, onChange, screen, meta, available }: Pick<ScreenProps, 'state' | 'onChange' | 'screen' | 'meta' | 'available'>): MenuItem[] {
  const { resetLayout, prompt, confirm, toast } = useAppActions()
  const [saved, setSaved] = useSavedLayouts()
  const currentName = useCurrentLayoutName()

  /** Guarda o arranjo de agora com o nome que o usuário escolher (o nome do layout em uso vem sugerido; o mesmo nome substitui o layout antigo). */
  const saveLayout = async () => {
    const name = await prompt({ title: t('layouts.saveTitle'), label: t('layouts.name'), placeholder: t('layouts.namePlaceholder'), initial: currentName, confirmLabel: t('layouts.save') })
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
    return { label: meta[view].label, checked: shown, onClick: () => onChange(toggleIn(state, view, screen)) }
  }

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
        actions: [{ icon: '✕', title: t('layouts.delete'), onClick: () => deleteSavedLayout(saved, setSaved, layout.id) }]
      }))
    })
  }
  items.push({ label: t('workbench.resetLayout'), onClick: () => void resetLayout() })
  return items
}
