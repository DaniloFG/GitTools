import type { CSSProperties } from 'react'
import type { RepoInfo } from '../../../shared/types'
import { useDrop } from '../useDrop'
import { t } from '../i18n'
import { repoColor, type RepoSummary } from '../workspace'
import type { DragPayload } from '../dnd'

interface RepoTabsProps {
  repos: RepoInfo[]
  active: string | null
  summaries: Record<string, RepoSummary>
  onActivate(root: string): void
  onClose(root: string): void
  onMenu(event: React.MouseEvent, root: string): void
  onAdd(event: React.MouseEvent): void
  /** Commits soltos sobre uma aba (de outro repositório, o ativo): pede a confirmação da aplicação. */
  onDropCommits(root: string, shas: string[]): void
}

/**
 * Barra de abas dos repositórios abertos. Cada aba tem a cor do repositório (estável), o nome, a branch e os
 * indicadores (alterações, conflito, operação em andamento). Clique troca; clique do meio ou × fecha.
 */
export function RepoTabs({ repos, active, summaries, onActivate, onClose, onMenu, onAdd, onDropCommits }: RepoTabsProps) {
  return (
    <div className="repo-tabs" role="tablist" aria-label={t('repoTabs.list')}>
      {repos.map((repo) => (
        <RepoTab
          key={repo.root}
          repo={repo}
          isActive={repo.root === active}
          summary={summaries[repo.root]}
          onActivate={onActivate}
          onClose={onClose}
          onMenu={onMenu}
          onDropCommits={onDropCommits}
        />
      ))}
      <button className="repo-tab-add" onClick={onAdd} title={t('repoTabs.addTab')} aria-label={t('repoTabs.addTab')}>
        +
      </button>
    </div>
  )
}

interface RepoTabProps {
  repo: RepoInfo
  isActive: boolean
  summary: RepoSummary | undefined
  onActivate(root: string): void
  onClose(root: string): void
  onMenu(event: React.MouseEvent, root: string): void
  onDropCommits(root: string, shas: string[]): void
}

function RepoTab({ repo, isActive, summary, onActivate, onClose, onMenu, onDropCommits }: RepoTabProps) {
  // Só outro repositório aceita commits soltos: o ativo já é a origem deles.
  const drop = useDrop(
    (payload: DragPayload) => payload.type === 'commits' && !isActive,
    (payload) => {
      if (payload.type === 'commits') onDropCommits(repo.root, payload.shas)
    }
  )
  const color = repoColor(repo.root)
  const branch = !summary ? '…' : summary.detached ? (summary.headSha?.slice(0, 7) ?? t('repoTabs.noBranch')) : (summary.branch ?? t('repoTabs.noBranch'))
  const className = ['repo-tab', isActive ? 'active' : '', drop.over ? 'drop-over' : ''].filter(Boolean).join(' ')

  return (
    <div
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      className={className}
      style={{ '--repo': color } as CSSProperties}
      title={`${repo.root}${isActive ? '' : `\n${t('repoTabs.cross.dropHelp')}`}`}
      onClick={() => !isActive && onActivate(repo.root)}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !isActive) {
          e.preventDefault()
          onActivate(repo.root)
        }
      }}
      onMouseDown={(e) => {
        // O clique do meio fecha a aba (sem o "autoscroll" do navegador).
        if (e.button === 1) e.preventDefault()
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        onClose(repo.root)
      }}
      onContextMenu={(e) => onMenu(e, repo.root)}
      {...drop.props}
    >
      <span className="repo-tab-dot" aria-hidden />
      <span className="repo-tab-name">{repo.name}</span>
      <span className="repo-tab-branch" title={t('toolbar.currentBranch')}>
        ⎇ {branch}
      </span>
      {summary && summary.changes > 0 && (
        <span className="repo-tab-badge" title={t('repoTabs.changes', { count: summary.changes })}>
          {summary.changes}
        </span>
      )}
      {summary && summary.conflicts > 0 && (
        <span className="repo-tab-flag conflict" title={t('repoTabs.conflicts')} aria-label={t('repoTabs.conflicts')}>
          ⚠
        </span>
      )}
      {summary && summary.operation !== 'none' && (
        <span className="repo-tab-flag operation" title={t('repoTabs.operation')} aria-label={t('repoTabs.operation')}>
          ⟳
        </span>
      )}
      <button
        className="repo-tab-close"
        title={t('repoTabs.closeHelp')}
        aria-label={t('repoTabs.closeAria', { repo: repo.name })}
        onClick={(e) => {
          e.stopPropagation()
          onClose(repo.root)
        }}
      >
        ×
      </button>
    </div>
  )
}
