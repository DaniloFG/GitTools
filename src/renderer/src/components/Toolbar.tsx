import { useRecentRepos } from '../recent'
import { useActions } from '../actions'
import type { RecentRepo } from '../../../shared/api'
import { useApp } from '../context'
import { errorMessage } from '../format'
import { git } from '../git'
import { useLayout } from '../layout'
import { t } from '../i18n'
import {
  TOOLBAR_ITEM_IDS,
  TOOLBAR_ITEM_LABELS,
  isToolbarItemShown,
  parseHiddenToolbarItems,
  toggleToolbarItem,
  type ToolbarItemId
} from '../toolbarItems'
import { normalizeRoot, repoColor } from '../workspace'
import { ScreenTabs, usePanelsItems, type ScreenProps } from './Screens'
import { SponsorButton } from './Sponsor'

interface ToolbarProps extends ScreenProps {
  onOpenRepository(path?: string, create?: boolean): void
  onClone(): void
}

/**
 * Barra superior única: repositório e branch, as telas (History, Changes…), as ações do Git e o menu ⚙.
 * Cada item pode ser escondido pelo menu (Barra de ferramentas); os escondidos ficam salvos como preferência.
 * Em janelas estreitas os botões mostram só o ícone (container query) e as telas rolam na horizontal.
 */
export function Toolbar({ onOpenRepository, onClone, state, onChange, screen, onScreen, meta, available, changeCount, dashboards, onDashboards }: ToolbarProps) {
  const { repo, data, toast, showMenu, openStudio, openSettings, openInEditor, workspace } = useApp()
  const { head, createBranch, createTag, stash, push, pushDialog, fetchRemote, pullRemote } = useActions()
  const { status } = data
  const [hidden, setHidden] = useLayout<ToolbarItemId[]>('pref.toolbar.hidden', parseHiddenToolbarItems)
  const shown = (id: ToolbarItemId) => isToolbarItemShown(hidden, id)
  const panelItems = usePanelsItems({ state, onChange, screen, meta, available })

  const { favorites, others, setFavorite, remove } = useRecentRepos(repo)
  const showError = (error: unknown) => toast('error', errorMessage(error))
  /** Repositórios já abertos nesta sessão aparecem marcados (abrir um deles só ativa a aba). */
  const openRoots = new Set(workspace.repos.map((r) => normalizeRoot(r.root)))
  const repoItem = (r: RecentRepo) => ({
    label: `${r.favorite ? '★ ' : ''}${r.name}${openRoots.has(normalizeRoot(r.path)) ? ` · ${t('repoTabs.openBadge')}` : ''}`,
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
      { label: t('toolbar.openFolder'), onClick: () => window.gittools.openFile('.', repo.root) },
      'separator',
      { label: t('repoTabs.closeThis'), onClick: () => workspace.close(repo.root) },
      { label: t('repoTabs.closeOthers'), onClick: () => workspace.closeOthers(repo.root), disabled: workspace.repos.length < 2 },
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
      { label: t('toolbar.pushForce'), onClick: () => push({ force: 'force' }), danger: true },
      'separator',
      ...(remotes.length > 1
        ? [...remotes.map((r) => ({ label: t('toolbar.pushTo', { remote: r.name }), hint: r.pushUrl, onClick: () => push({ remote: r.name }) })), 'separator' as const]
        : []),
      { label: t('toolbar.pushOptions'), onClick: () => pushDialog() },
      { label: t('toolbar.manageRemotes'), onClick: () => openSettings('git') }
    ])
  }

  /** Botão ＋ Novo (ou a seta ao lado): criar branch, criar tag ou guardar as alterações. */
  const newMenu = (e: React.MouseEvent) =>
    showMenu(e, [
      { label: t('toolbar.newBranch'), onClick: () => createBranch() },
      { label: t('toolbar.newTag'), onClick: () => createTag() },
      'separator',
      { label: t('toolbar.stash'), onClick: () => stash() }
    ])

  /** ⚙ Menu: configurações; a aparência (painéis e layouts); e quais itens aparecem nesta barra. */
  const barMenu = (e: React.MouseEvent) =>
    showMenu(e, [
      { label: t('toolbar.settings'), onClick: () => openSettings() },
      'separator',
      { label: t('toolbar.appearance'), submenu: panelItems },
      {
        label: t('toolbar.toolbarMenu'),
        submenu: TOOLBAR_ITEM_IDS.map((id) => ({
          label: `${shown(id) ? '✓' : ' '} ${t(TOOLBAR_ITEM_LABELS[id])}`,
          onClick: () => setHidden((prev) => toggleToolbarItem(prev, id))
        }))
      }
    ])

  return (
    <header className="toolbar">
      {shown('repo') && (
        <button className="repo-button" onClick={repoMenu} title={repo.root} style={{ '--repo': repoColor(repo.root) } as React.CSSProperties}>
          <span className="repo-button-dot" aria-hidden />
          <span className="logo-mark">⑂</span>
          <strong>{repo.name}</strong> ▾
        </button>
      )}
      {shown('branch') && (
        <span className="current-branch" title={t('toolbar.currentBranch')}>
          ⎇ {head ?? t('toolbar.detached', { sha: status.headSha?.slice(0, 7) ?? t('toolbar.noCommits') })}
        </span>
      )}
      {shown('screens') && (
        <ScreenTabs state={state} meta={meta} screen={screen} onScreen={onScreen} available={available} changeCount={changeCount} dashboards={dashboards} onDashboards={onDashboards} />
      )}
      <div className="toolbar-spacer" />
      {shown('fetch') && (
        <button className="tb-btn" onClick={() => fetchRemote()} title={t('toolbar.fetchHelp')} aria-label={t('toolbar.fetch')}>
          <span aria-hidden>⟳</span>
          <span className="tb-label">{t('toolbar.fetch')}</span>
        </button>
      )}
      {shown('pull') && (
        <button className="tb-btn" onClick={() => pullRemote()} title={t('toolbar.pullHelp')} aria-label={t('toolbar.pull')}>
          <span aria-hidden>↓</span>
          <span className="tb-label">{t('toolbar.pull')}</span>
          {status.behind > 0 && <span className="badge">{status.behind}</span>}
        </button>
      )}
      {shown('push') && (
        <span className="split-button">
          <button className="tb-btn" onClick={() => push()} onContextMenu={pushMenu} title={t('toolbar.pushHelp')} aria-label={t('toolbar.push')}>
            <span aria-hidden>↑</span>
            <span className="tb-label">{t('toolbar.push')}</span>
            {status.ahead > 0 && <span className="badge">{status.ahead}</span>}
          </button>
          <button className="split-arrow tb-btn" onClick={pushMenu} title={t('toolbar.pushMore')} aria-label={t('toolbar.pushMore')} aria-haspopup="menu">
            ▾
          </button>
        </span>
      )}
      {shown('new') && (
        <span className="split-button">
          <button className="tb-btn" onClick={newMenu} title={t('toolbar.newHelp')} aria-label={t('toolbar.new')} aria-haspopup="menu">
            <span aria-hidden>＋</span>
            <span className="tb-label">{t('toolbar.new')}</span>
          </button>
          <button className="split-arrow tb-btn" onClick={newMenu} title={t('toolbar.newMore')} aria-label={t('toolbar.newMore')} aria-haspopup="menu">
            ▾
          </button>
        </span>
      )}
      {shown('editor') && (
        <button className="tb-btn" onClick={() => openInEditor()} title={t('toolbar.openInEditorHelp')} aria-label={t('common.openInEditor')}>
          <span aria-hidden>✎</span>
          <span className="tb-label">{t('common.openInEditor')}</span>
        </button>
      )}
      {shown('studio') && (
        <button className="primary tb-btn" onClick={() => openStudio({ target: head ?? undefined })} aria-label={t('studio.name')}>
          <span aria-hidden>🍒</span>
          <span className="tb-label">{t('studio.name')}</span>
        </button>
      )}
      <SponsorButton compact />
      <button className="icon-button tb-menu" onClick={barMenu} title={t('toolbar.menuHelp')} aria-label={t('toolbar.menu')} aria-haspopup="menu">
        ⚙
      </button>
    </header>
  )
}
