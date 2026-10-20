import { useEffect, useState } from 'react'
import type { RecentRepo } from '../../../shared/api'
import { useActions } from '../actions'
import { useApp } from '../context'
import { git } from '../git'

export function Toolbar({ onOpenRepository }: { onOpenRepository(path?: string, create?: boolean): void }) {
  const { repo, data, run, showMenu, openStudio, openSettings, openShortcuts } = useApp()
  const { head, createBranch, stash } = useActions()
  const [recent, setRecent] = useState<RecentRepo[]>([])
  const { status } = data

  useEffect(() => {
    window.gittools.recentRepositories().then(setRecent, () => setRecent([]))
  }, [repo])

  const repoMenu = (e: React.MouseEvent) =>
    showMenu(e, [
      { label: 'Abrir repositório…', onClick: () => onOpenRepository() },
      { label: 'Criar repositório…', onClick: () => onOpenRepository(undefined, true) },
      { label: 'Abrir pasta no sistema', onClick: () => window.gittools.openFile('.') },
      ...(recent.filter((r) => r.path !== repo.root).length ? (['separator'] as const) : []),
      ...recent
        .filter((r) => r.path !== repo.root)
        .slice(0, 8)
        .map((r) => ({ label: r.name, hint: r.path, onClick: () => onOpenRepository(r.path) }))
    ])

  return (
    <header className="toolbar">
      <button className="repo-button" onClick={repoMenu} title={repo.root}>
        <span className="logo-mark">⑂</span>
        <strong>{repo.name}</strong> ▾
      </button>
      <span className="current-branch" title="Branch atual">
        {head ? <>⎇ {head}</> : <>⎇ HEAD destacado ({status.headSha?.slice(0, 7) ?? 'sem commits'})</>}
      </span>
      <div className="toolbar-group">
        <button onClick={() => run('Fetch', () => git.fetch())} title="Buscar novidades de todos os remotos">
          ⟳ Fetch
        </button>
        <button onClick={() => run('Pull', () => git.pull())} title="Trazer e integrar as alterações do remoto">
          ↓ Pull {status.behind > 0 && <span className="badge">{status.behind}</span>}
        </button>
        <button onClick={() => run('Push', () => git.push())} title="Enviar seus commits para o remoto">
          ↑ Push {status.ahead > 0 && <span className="badge">{status.ahead}</span>}
        </button>
      </div>
      <div className="toolbar-group">
        <button onClick={() => createBranch()}>＋ Branch</button>
        <button onClick={stash} title="Guardar as alterações locais e limpar a área de trabalho">
          ⧉ Stash
        </button>
      </div>
      <div className="toolbar-spacer" />
      <button className="primary" onClick={() => openStudio({ target: head ?? undefined })}>
        🍒 Cherry-pick Studio
      </button>
      <button className="icon-button" onClick={openShortcuts} title="Atalhos de teclado (F1)">
        ⌨
      </button>
      <button className="icon-button" onClick={openSettings} title="Configurações (Ctrl+,)">
        ⚙
      </button>
    </header>
  )
}
