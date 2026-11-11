import { useEffect, useRef } from 'react'
import { useActions } from '../actions'
import { useAppActions, useAppSettings, useRepoData } from '../context'
import { DIFF_NAV_ACTIONS, emitDiffNav } from '../diffNav'
import { comboFromEvent, keepsNativeEdit, resolveBindings, worksInInputs } from '../shortcuts'
import { HISTORY_SEARCH_ID } from './CommitList'
import { toggleScreenShown } from '../dockStore'

/** Escuta o teclado e executa as ações conforme os atalhos configurados. */
export function KeyboardShortcuts({ disabled, onOpenRepository }: { disabled: boolean; onOpenRepository(): void }) {
  // Só o que o listener usa: os atalhos (configurações), a aba e o repositório (dados) e as funções (ações).
  const { settings } = useAppSettings()
  const { repo, workspace } = useRepoData()
  const { setView, setDashboards, refresh, openStudio, openSettings, openShortcuts } = useAppActions()
  const actions = useActions()
  // Guarda a versão mais recente desses valores sem reinstalar o listener a cada render.
  const current = {
    shortcuts: settings.shortcuts,
    repo,
    workspace,
    setView,
    setDashboards,
    refresh,
    openStudio,
    openSettings,
    openShortcuts,
    actions,
    disabled,
    onOpenRepository
  }
  const latest = useRef(current)
  latest.current = current

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { shortcuts, repo, workspace, setView, setDashboards, refresh, openStudio, openSettings, openShortcuts, actions, disabled, onOpenRepository } = latest.current
      const combo = comboFromEvent(e)
      if (!combo) return
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      const bindings = resolveBindings(shortcuts)
      const action = Object.keys(bindings).find((id) => bindings[id] === combo)
      if (!action) return
      if (typing && !worksInInputs(combo)) return
      // Copiar, colar e selecionar tudo ficam com o campo ou com o trecho selecionado, mesmo se um atalho usar a combinação.
      if (keepsNativeEdit(combo, typing, !!window.getSelection()?.toString())) return
      // Com um diálogo aberto, só a ajuda e as configurações respondem.
      // (A navegação nos diffs funciona também dentro de diálogos, como o Studio.)
      if (disabled && action !== 'help' && action !== 'settings' && !(action in DIFF_NAV_ACTIONS)) return
      e.preventDefault()
      const handlers: Record<string, () => unknown> = {
        'view.history': () => setView('history'),
        'view.changes': () => setView('changes'),
        'view.files': () => setView('files'),
        'view.compare': () => setView('compare'),
        'view.dashboards': () => setDashboards(true),
        'layout.sidebar': () => toggleScreenShown('branches'),
        'history.search': () => {
          setView('history')
          // Espera o painel do histórico aparecer (se outra aba estava à frente) para focar a pesquisa.
          const focusSearch = (tries: number) => {
            const input = document.getElementById(HISTORY_SEARCH_ID) as HTMLInputElement | null
            if (input) {
              input.focus()
              input.select()
            } else if (tries > 0) requestAnimationFrame(() => focusSearch(tries - 1))
          }
          requestAnimationFrame(() => focusSearch(12))
        },
        studio: () => openStudio({ target: actions.head ?? undefined }),
        'branch.new': () => actions.createBranch(),
        stash: () => actions.stash(),
        fetch: () => actions.fetchRemote(),
        pull: () => actions.pullRemote(),
        push: () => actions.push(),
        'push.force': () => actions.push({ force: 'lease' }),
        refresh: () => refresh(),
        'repo.open': onOpenRepository,
        'tab.next': () => workspace.cycle(1),
        'tab.prev': () => workspace.cycle(-1),
        'tab.close': () => workspace.close(repo.root),
        settings: () => openSettings(),
        help: openShortcuts
      }
      const nav = DIFF_NAV_ACTIONS[action]
      if (nav) {
        emitDiffNav(...nav)
        return
      }
      void handlers[action]?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return null
}
