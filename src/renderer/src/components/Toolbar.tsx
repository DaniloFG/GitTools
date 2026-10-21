import { useEffect, useState } from 'react'
import type { RecentRepo } from '../../../shared/api'
import { useActions } from '../actions'
import { useApp } from '../context'
import { git } from '../git'
import { t } from '../i18n'

export function Toolbar({ onOpenRepository, onClone }: { onOpenRepository(path?: string, create?: boolean): void; onClone(): void }) {
  const { repo, data, run, showMenu, openStudio, openSettings, openInEditor, resetLayout } = useApp()
  const { head, createBranch, createTag, stash } = useActions()
  const [recent, setRecent] = useState<RecentRepo[]>([])
  const { status } = data

  useEffect(() => {
    window.gittools.recentRepositories().then(setRecent, () => setRecent([]))
  }, [repo])

  const others = recent.filter((r) => r.path !== repo.root)
  const repoMenu = (e: React.MouseEvent) =>
    showMenu(e, [
      { label: t('toolbar.openRepository'), onClick: () => onOpenRepository() },
      { label: t('toolbar.createRepository'), onClick: () => onOpenRepository(undefined, true) },
      { label: t('clone.menu'), onClick: onClone },
      { label: t('toolbar.openFolder'), onClick: () => window.gittools.openFile('.') },
      ...(others.length ? (['separator'] as const) : []),
      ...others.slice(0, 8).map((r) => ({ label: r.name, hint: r.path, onClick: () => onOpenRepository(r.path) }))
    ])

  return (
    <header className="toolbar">
      <button className="repo-button" onClick={repoMenu} title={repo.root}>
        <span className="logo-mark">⑂</span>
        <strong>{repo.name}</strong> ▾
      </button>
      <span className="current-branch" title={t('toolbar.currentBranch')}>
        ⎇ {head ?? t('toolbar.detached', { sha: status.headSha?.slice(0, 7) ?? t('toolbar.noCommits') })}
      </span>
      <div className="toolbar-group">
        <button onClick={() => run(t('busy.fetch'), () => git.fetch())} title={t('toolbar.fetchHelp')}>
          ⟳ {t('toolbar.fetch')}
        </button>
        <button onClick={() => run(t('busy.pull'), () => git.pull())} title={t('toolbar.pullHelp')}>
          ↓ {t('toolbar.pull')} {status.behind > 0 && <span className="badge">{status.behind}</span>}
        </button>
        <button onClick={() => run(t('busy.push'), () => git.push())} title={t('toolbar.pushHelp')}>
          ↑ {t('toolbar.push')} {status.ahead > 0 && <span className="badge">{status.ahead}</span>}
        </button>
      </div>
      <div className="toolbar-group">
        <button onClick={() => createBranch()}>＋ {t('toolbar.branch')}</button>
        <button onClick={() => createTag()} title={t('toolbar.tagHelp')}>
          ⌂ {t('toolbar.tag')}
        </button>
        <button onClick={stash} title={t('toolbar.stashHelp')}>
          ⧉ {t('toolbar.stash')}
        </button>
        <button onClick={() => openInEditor()} title={t('toolbar.openInEditorHelp')}>
          ✎ {t('common.openInEditor')}
        </button>
      </div>
      <div className="toolbar-spacer" />
      <button className="primary" onClick={() => openStudio({ target: head ?? undefined })}>
        🍒 {t('studio.name')}
      </button>
      <button className="icon-button reset-layout-button" onClick={resetLayout} title={t('workbench.resetLayoutHelp')} aria-label={t('workbench.resetLayout')}>
        ⊞
      </button>
      <button className="icon-button settings-button" onClick={() => openSettings()} title={t('toolbar.settings')}>
        ⚙
      </button>
    </header>
  )
}
