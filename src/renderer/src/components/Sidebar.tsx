import type { ReactNode } from 'react'
import type { BranchInfo, StashInfo } from '../../../shared/types'
import type { HistoryScope } from '../App'
import { useActions } from '../actions'
import { useBranchMenu } from '../branchMenu'
import { useApp } from '../context'
import { endDrag, startDrag } from '../dnd'
import { git } from '../git'
import { relativeDate } from '../format'
import { commitColors, laneColor } from '../graph'
import { useDrop } from '../useDrop'
import { useLayout } from '../layout'
import { t } from '../i18n'

interface Props {
  scope: HistoryScope
  onScope(scope: HistoryScope): void
}

export function Sidebar({ scope, onScope }: Props) {
  const { data } = useApp()
  // Cada branch usa a cor da sua trilha no grafo do histórico.
  const colors = commitColors(data.log, data.status.headSha)
  const colorOf = (b: BranchInfo) => colors.get(b.sha)
  const local = data.branches.filter((b) => !b.remote)
  const remotes = new Map<string, BranchInfo[]>()
  for (const b of data.branches.filter((b) => b.remote)) {
    remotes.set(b.remote!, [...(remotes.get(b.remote!) ?? []), b])
  }

  return (
    <aside className="sidebar">
      <p className="sidebar-hint">{t('sidebar.hint')}</p>
      <Section id="branches" title={t('sidebar.branches')} count={local.length}>
        {local.map((b) => (
          <BranchItem key={b.fullRef} branch={b} color={colorOf(b)} active={scope.kind === 'ref' && scope.ref === b.name} onScope={onScope} />
        ))}
      </Section>
      {[...remotes.entries()].map(([remote, list]) => (
        <Section key={remote} id={`remote.${remote}`} title={t('sidebar.remote', { remote })} count={list.length} collapsed>
          {list.map((b) => (
            <BranchItem key={b.fullRef} branch={b} color={colorOf(b)} active={scope.kind === 'ref' && scope.ref === b.name} onScope={onScope} />
          ))}
        </Section>
      ))}
      <Section id="tags" title={t('sidebar.tags')} count={data.tags.length} collapsed>
        {data.tags.map((t) => (
          <TagItem key={t.name} name={t.name} sha={t.sha} />
        ))}
      </Section>
      <Section id="stashes" title={t('sidebar.stashes')} count={data.stashes.length}>
        {data.stashes.map((s) => (
          <StashItem key={s.ref} stash={s} />
        ))}
      </Section>
    </aside>
  )
}

interface SectionProps {
  /** Nome sob o qual fica guardado se a seção está aberta. */
  id: string
  title: string
  count: number
  children: ReactNode
  collapsed?: boolean
}

function Section({ id, title, count, children, collapsed = false }: SectionProps) {
  const [open, setOpen] = useLayout(`sidebar.${id}.open`, (value) => (typeof value === 'boolean' ? value : !collapsed))
  return (
    <section className="sidebar-section">
      <button className="section-header" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'}</span> {title} <span className="count">{count}</span>
      </button>
      {open && <ul>{children}</ul>}
    </section>
  )
}

interface BranchItemProps {
  branch: BranchInfo
  /** Cor da trilha da branch no grafo (ausente quando o commit não está no histórico carregado). */
  color: number | undefined
  active: boolean
  onScope(s: HistoryScope): void
}

function BranchItem({ branch, color, active, onScope }: BranchItemProps) {
  const { showMenu } = useApp()
  const actions = useActions()
  const branchMenu = useBranchMenu(onScope)
  const isRemote = !!branch.remote
  const drop = useDrop(
    (p) => !isRemote && !(p.type === 'branch' && p.name === branch.name) && p.type !== 'files',
    (p) => void actions.dropOnBranch(p, branch.name)
  )

  const menu = (e: React.MouseEvent) => showMenu(e, branchMenu(branch))

  const label = isRemote ? branch.name.slice(branch.remote!.length + 1) : branch.name
  return (
    <li
      className={`branch-item ${branch.current ? 'current' : ''} ${active ? 'active' : ''} ${drop.over ? 'drop-over' : ''}`}
      draggable
      onDragStart={(e) => startDrag(e, { type: 'branch', name: branch.name, remote: isRemote }, `⎇ ${branch.name}`)}
      onDragEnd={endDrag}
      onClick={() => onScope({ kind: 'ref', ref: branch.name })}
      onDoubleClick={() => !branch.current && actions.checkout(branch.name)}
      onContextMenu={menu}
      title={`${branch.name}${branch.current ? ` (${t('toolbar.currentBranch')})` : ''}\n${branch.subject}\n${relativeDate(branch.date)}\n\n${t('sidebar.branchTooltip')}`}
      style={color === undefined ? undefined : ({ '--branch-color': laneColor(color) } as React.CSSProperties)}
      {...drop.props}
    >
      <span className="branch-icon">{branch.current ? '✓' : '⎇'}</span>
      <span className="branch-name">{label}</span>
      {(branch.ahead > 0 || branch.behind > 0) && (
        <span className="track">
          {branch.ahead > 0 && `↑${branch.ahead}`}
          {branch.behind > 0 && ` ↓${branch.behind}`}
        </span>
      )}
      {drop.over && <span className="drop-hint">{t('sidebar.dropHere')}</span>}
    </li>
  )
}

function TagItem({ name, sha }: { name: string; sha: string }) {
  const { selectCommit, showMenu } = useApp()
  const actions = useActions()
  return (
    <li
      className="branch-item"
      onClick={() => selectCommit(sha)}
      onContextMenu={(e) =>
        showMenu(e, [
          { label: t('sidebar.menu.checkoutDetached'), onClick: () => actions.checkout(name) },
          { label: t('sidebar.menu.newBranchFromTag'), onClick: () => actions.createBranch(name) }
        ])
      }
    >
      <span className="branch-icon">⌂</span>
      <span className="branch-name">{name}</span>
    </li>
  )
}

function StashItem({ stash }: { stash: StashInfo }) {
  const { run, confirm } = useApp()
  const drop = async () => {
    const ok = await confirm({
      title: t('sidebar.stash.dropTitle'),
      message: t('sidebar.stash.dropMessage', { message: stash.message }),
      confirmLabel: t('common.discard'),
      danger: true
    })
    if (ok) await run(t('busy.droppingStash'), () => git.stashDrop(stash.index))
  }
  return (
    <li className="stash-item" title={`${stash.ref} · ${relativeDate(stash.date)}`}>
      <span className="branch-name">{stash.message}</span>
      <span className="stash-actions">
        <button onClick={() => run(t('busy.applyingStash'), () => git.stashApply(stash.index, true))} title={t('sidebar.stash.pop')}>
          ⤓
        </button>
        <button onClick={() => run(t('busy.applyingStash'), () => git.stashApply(stash.index))} title={t('sidebar.stash.apply')}>
          ⧉
        </button>
        <button onClick={drop} title={t('common.discard')}>
          ✕
        </button>
      </span>
    </li>
  )
}
