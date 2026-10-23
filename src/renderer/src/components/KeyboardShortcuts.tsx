import { useEffect, useRef } from 'react'
import { useActions } from '../actions'
import { useApp } from '../context'
import { git } from '../git'
import { t } from '../i18n'
import { DIFF_NAV_ACTIONS, emitDiffNav } from '../diffNav'
import { comboFromEvent, resolveBindings, worksInInputs } from '../shortcuts'
import { HISTORY_SEARCH_ID } from './CommitList'
import { toggleScreenShown } from '../dockStore'

/** Escuta o teclado e executa as ações conforme os atalhos configurados. */
export function KeyboardShortcuts({ disabled, onOpenRepository }: { disabled: boolean; onOpenRepository(): void }) {
  const app = useApp()
  const actions = useActions()
  // Guarda a versão mais recente das funções sem reinstalar o listener a cada render.
  const latest = useRef({ app, actions, disabled, onOpenRepository })
  latest.current = { app, actions, disabled, onOpenRepository }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { app, actions, disabled, onOpenRepository } = latest.current
      const combo = comboFromEvent(e)
      if (!combo) return
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      const bindings = resolveBindings(app.settings.shortcuts)
      const action = Object.keys(bindings).find((id) => bindings[id] === combo)
      if (!action) return
      if (typing && !worksInInputs(combo)) return
      // Com um diálogo aberto, só a ajuda e as configurações respondem.
      // (A navegação nos diffs funciona também dentro de diálogos, como o Studio.)
      if (disabled && action !== 'help' && action !== 'settings' && !(action in DIFF_NAV_ACTIONS)) return
      e.preventDefault()
      const handlers: Record<string, () => unknown> = {
        'view.history': () => app.setView('history'),
        'view.changes': () => app.setView('changes'),
        'view.files': () => app.setView('files'),
        'view.compare': () => app.setView('compare'),
        'view.dashboards': () => app.setDashboards(true),
        'layout.sidebar': () => toggleScreenShown('branches'),
        'history.search': () => {
          app.setView('history')
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
        studio: () => app.openStudio({ target: actions.head ?? undefined }),
        'branch.new': () => actions.createBranch(),
        stash: () => actions.stash(),
        fetch: () => app.run(t('busy.fetch'), () => git.fetch()),
        pull: () => app.run(t('busy.pull'), () => git.pull()),
        push: () => actions.push(),
        'push.force': () => actions.push({ force: 'lease' }),
        refresh: () => app.refresh(),
        'repo.open': onOpenRepository,
        settings: () => app.openSettings(),
        help: app.openShortcuts
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
