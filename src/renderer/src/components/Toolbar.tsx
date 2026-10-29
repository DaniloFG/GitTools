import { useRecentRepos } from '../recent'
import { useActions } from '../actions'
import type { RecentRepo } from '../../../shared/api'
import { useApp } from '../context'
import { errorMessage } from '../format'
import { git } from '../git'
import { t } from '../i18n'

interface ToolbarProps {
  onOpenRepository(path?: string, create?: boolean): void
  onClone(): void
}

/** Barra de ferramentas do repositório. Os menus do topo (telas e painéis) ficam na barra logo abaixo, em `App`. */
export function Toolbar({ onOpenRepository, onClone }: ToolbarProps) {
  const { repo, data, toast, showMenu, openStudio, openSettings, openInEditor } = useApp()
  const { head, createBranch, createTag, stash, push, pushDialog, fetchRemote, pullRemote } = useActions()
  const { status } = data

  const { favorites, others, setFavorite, remove } = useRecentRepos(repo)
  const showError = (error: unknown) => toast('error', errorMessage(error))
  const repoItem = (r: RecentRepo) => ({
    label: `${r.favorite ? '★ ' : ''}${r.name}`,
    hint: r.path,
    onClick: () => onOpenRepository(r.path),
    actions: [
      { icon: r.favorite ? '★' : '☆', title: r.favorite ? t('welcome.unfavorite') : t('welcome.favorite'), onClick: () => setFavorite(r.path, !r.favorite).catch(showError) },
      { icon: '✕', title: t('welcome.removeRecent'), onClick: () => remove(r.path).catch(showError) }
    ]
  })
  const otherFavorites = favorites.filter((r) => r.path !== repo.root)
  const otherRecent = others.filter((r) => r.path !== repo.root)
  const repoMenu = (e: React.MouseEvent) =>
    showMenu(e, [
      { label: t('toolbar.openRepository'), onClick: () => onOpenRepository() },
      { label: t('toolbar.createRepository'), onClick: () => onOpenRepository(undefined, true) },
      { label: t('clone.menu'), onClick: onClone },
      { label: t('toolbar.openFolder'), onClick: () => window.gittools.openFile('.') },
      ...(otherFavorites.length ? (['separator'] as const) : []),
      ...otherFavorites.map(repoItem),
      ...(otherRecent.length ? (['separator'] as const) : []),
      ...otherRecent.slice(0, 8).map(repoItem)
    ])

  /** Seta ao lado de Enviar (ou botão direito nele): force push, outro remote, opções e remotes. */
  const pushMenu = async (e: React.MouseEvent) => {
    e.preventDefault()
    const remotes = await git.remotes().catch((error) => {
      showError(error)
      return []
    })
    showMenu(e, [
      { label: t('toolbar.push'), onClick: () => push() },
      { label: t('toolbar.pushForceLease'), onClick: () => push({ force: 'lease' }) },
      { label: t('toolbar.pushForce'), onClick: () => push({ force: 'force' }), danger: true },
      'separator',
      ...(remotes.length > 1
        ? [...remotes.map((r) => ({ label: t('toolbar.pushTo', { remote: r.name }), hint: r.pushUrl, onClick: () => push({ remote: r.name }) })), 'separator' as const]
        : []),
      { label: t('toolbar.pushOptions'), onClick: () => pushDialog() },
      { label: t('toolbar.manageRemotes'), onClick: () => openSettings('git') }
    ])
  }

  return (
    <header className="toolbar">
      <button className="repo-button" onClick={repoMenu} title={repo.root}>
        <span className="logo-mark">⑂</span>
        <strong>{repo.name}</strong> ▾
      </button>
      <span className="current-branch" title={t('toolbar.currentBranch')}>
        ⎇ {head ?? t('toolbar.detached', { sha: status.headSha?.slice(0, 7) ?? t('toolbar.noCommits') })}
      </span>
      <div className="toolbar-spacer" />
      <div className="toolbar-group">
        <button onClick={() => fetchRemote()} title={t('toolbar.fetchHelp')}>
          ⟳ {t('toolbar.fetch')}
        </button>
        <button onClick={() => pullRemote()} title={t('toolbar.pullHelp')}>
          ↓ {t('toolbar.pull')} {status.behind > 0 && <span className="badge">{status.behind}</span>}
        </button>
        <span className="split-button">
          <button onClick={() => push()} onContextMenu={pushMenu} title={t('toolbar.pushHelp')}>
            ↑ {t('toolbar.push')} {status.ahead > 0 && <span className="badge">{status.ahead}</span>}
          </button>
          <button className="split-arrow" onClick={pushMenu} title={t('toolbar.pushMore')} aria-label={t('toolbar.pushMore')} aria-haspopup="menu">
            ▾
          </button>
        </span>
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
      <button className="primary" onClick={() => openStudio({ target: head ?? undefined })}>
        🍒 {t('studio.name')}
      </button>
      <button className="icon-button settings-button" onClick={() => openSettings()} title={t('toolbar.settings')}>
        ⚙
      </button>
    </header>
  )
}
