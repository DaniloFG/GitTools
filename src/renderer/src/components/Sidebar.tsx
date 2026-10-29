import { Fragment, useRef, type ReactNode } from 'react'
import type { BranchInfo, StashInfo } from '../../../shared/types'
import { ALL_SCOPE, checkedRefs, toggleGroup, toggleRef, type HistoryScope } from '../historyScope'
import { useActions } from '../actions'
import { useBranchMenu } from '../branchMenu'
import { useApp } from '../context'
import { endDrag, startDrag } from '../dnd'
import { git } from '../git'
import { relativeDate } from '../format'
import { commitColors, laneColor } from '../graph'
import { useDrop } from '../useDrop'
import { useLayout } from '../layout'
import { moveItem, parseOrder, startReorder } from '../reorder'
import { t } from '../i18n'
import { PaneSlot } from '../slots'

interface Props {
  scope: HistoryScope
  /** `reveal: false` muda só o filtro, sem trazer o Histórico à frente (marcar caixas não pode mexer nos painéis). */
  onScope(scope: HistoryScope, options?: { reveal?: boolean }): void
}

/**
 * Branches (locais e remotas), tags e stashes são três painéis independentes: cada um pode ficar em
 * qualquer lugar da janela, junto de qualquer outro painel.
 */
export function SidebarPanes({ scope, onScope }: Props) {
  return (
    <>
      <PaneSlot id="branches">
        <BranchesPanel scope={scope} onScope={onScope} />
      </PaneSlot>
      <PaneSlot id="tags">
        <TagsPanel />
      </PaneSlot>
      <PaneSlot id="stashes">
        <StashesPanel />
      </PaneSlot>
    </>
  )
}

/**
 * Cor de cada branch: a da sua trilha no grafo do histórico completo. A lista de branches é a referência e não
 * muda ao marcar branches (só o histórico e as linhas do tempo mudam): enquanto o histórico está filtrado, as
 * cores continuam as da última vez em que ele mostrava tudo.
 */
function useBranchColors(scope: HistoryScope): (b: BranchInfo) => number | undefined {
  const { data, repo } = useApp()
  const full = useRef<{ root: string; colors: Map<string, number> }>({ root: repo.root, colors: new Map() })
  if (full.current.root !== repo.root) full.current = { root: repo.root, colors: new Map() }
  const current = commitColors(data.log, data.status.headSha)
  if (scope.kind === 'all') for (const b of data.branches) if (current.has(b.sha)) full.current.colors.set(b.name, current.get(b.sha)!)
  return (b) => full.current.colors.get(b.name) ?? (scope.kind === 'all' ? current.get(b.sha) : undefined)
}

function BranchesPanel({ scope, onScope }: Props) {
  const { data } = useApp()
  const colorOf = useBranchColors(scope)
  const checked = checkedRefs(scope)
  const toggle = (name: string) => onScope(toggleRef(scope, name), { reveal: false })
  const groupAction = (list: BranchInfo[]) => ({
    label: '☑',
    title: t('sidebar.toggleGroup'),
    run: () => onScope(toggleGroup(scope, list.map((b) => b.name)), { reveal: false })
  })
  const local = data.branches.filter((b) => !b.remote)
  const remotes = new Map<string, BranchInfo[]>()
  for (const b of data.branches.filter((b) => b.remote)) {
    remotes.set(b.remote!, [...(remotes.get(b.remote!) ?? []), b])
  }

  const sections: { id: string; node: ReactNode }[] = [
    {
      id: 'branches',
      node: (
        <Section id="branches" title={t('sidebar.branches')} count={local.length} onReorder={move} action={groupAction(local)}>
          {local.map((b) => (
            <BranchItem key={b.fullRef} branch={b} color={colorOf(b)} active={scope.kind === 'ref' && scope.ref === b.name} checked={checked.includes(b.name)} onToggle={toggle} onScope={onScope} />
          ))}
        </Section>
      )
    },
    ...[...remotes.entries()].map(([remote, list]) => ({
      id: `remote.${remote}`,
      node: (
        <Section id={`remote.${remote}`} title={t('sidebar.remote', { remote })} count={list.length} collapsed onReorder={move} action={groupAction(list)}>
          {list.map((b) => (
            <BranchItem key={b.fullRef} branch={b} color={colorOf(b)} active={scope.kind === 'ref' && scope.ref === b.name} checked={checked.includes(b.name)} onToggle={toggle} onScope={onScope} />
          ))}
        </Section>
      )
    }))
  ]
  const ids = sections.map((s) => s.id)
  const [order, setOrder] = useLayout('order.sidebar', (value) => parseOrder(value, ids))
  function move(id: string, target: string) {
    setOrder((prev) => moveItem(prev, id, target))
  }

  return (
    <aside className="sidebar">
      <p className="sidebar-hint">{t('sidebar.hint')}</p>
      {/* Sempre presente, com a mesma altura: marcar branches não desloca a lista abaixo. */}
      <div className={`sidebar-filter ${checked.length > 0 ? 'active' : ''}`} role="status">
        <span title={checked.length > 0 ? t('sidebar.filterActive', { count: checked.length }) : t('sidebar.filterNone')}>
          {checked.length > 0 ? t('sidebar.filterActive', { count: checked.length }) : t('sidebar.filterNone')}
        </span>
        <button className="link" style={{ visibility: checked.length > 0 ? 'visible' : 'hidden' }} tabIndex={checked.length > 0 ? 0 : -1} onClick={() => onScope(ALL_SCOPE, { reveal: false })}>
          {t('sidebar.filterClear')}
        </button>
      </div>
      {order.map((id) => (
        <Fragment key={id}>{sections.find((s) => s.id === id)?.node}</Fragment>
      ))}
    </aside>
  )
}

function TagsPanel() {
  const { data } = useApp()
  const actions = useActions()
  return (
    <aside className="sidebar">
      <Section id="tags" title={t('sidebar.tags')} count={data.tags.length} action={{ label: '＋', title: t('actions.newTag.title'), run: () => actions.createTag() }}>
        {data.tags.map((tag) => (
          <TagItem key={tag.name} name={tag.name} sha={tag.sha} />
        ))}
      </Section>
    </aside>
  )
}

function StashesPanel() {
  const { data } = useApp()
  return (
    <aside className="sidebar">
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
  /** Arrastar o cabeçalho sobre outra seção troca a ordem delas (só quando há mais de uma no painel). */
  onReorder?(id: string, target: string): void
  /** Botão no cabeçalho (ex.: criar tag). */
  action?: { label: string; title: string; run(): void }
}

function Section({ id, title, count, children, collapsed = false, onReorder, action }: SectionProps) {
  const [open, setOpen] = useLayout(`sidebar.${id}.open`, (value) => (typeof value === 'boolean' ? value : !collapsed))
  return (
    <section className="sidebar-section" data-reorder={onReorder ? 'sidebar' : undefined} data-reorder-id={onReorder ? id : undefined}>
      <div className="section-header-row">
        <button
          className="section-header"
          title={onReorder ? t('layout.reorderHelp') : undefined}
          onClick={() => setOpen(!open)}
          onPointerDown={onReorder ? (e) => startReorder(e, 'sidebar', id, onReorder) : undefined}
        >
          <span>{open ? '▾' : '▸'}</span> {title} <span className="count">{count}</span>
        </button>
        {action && (
          <button className="section-action" title={action.title} onClick={action.run}>
            {action.label}
          </button>
        )}
      </div>
      {open && <ul>{children}</ul>}
    </section>
  )
}

interface BranchItemProps {
  branch: BranchInfo
  /** Cor da trilha da branch no grafo (ausente quando o commit não está no histórico carregado). */
  color: number | undefined
  active: boolean
  /** Marcada na caixa de seleção: o histórico lista só as branches marcadas. */
  checked: boolean
  onToggle(name: string): void
  onScope: Props['onScope']
}

function BranchItem({ branch, color, active, checked, onToggle, onScope }: BranchItemProps) {
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
      tabIndex={-1}
      data-copy={branch.name}
      data-copy-what="text"
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
      <input
        type="checkbox"
        className="branch-check"
        checked={checked}
        title={t('sidebar.showInHistory')}
        aria-label={t('sidebar.showInHistory')}
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onChange={() => onToggle(branch.name)}
      />
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
          { label: t('sidebar.menu.newBranchFromTag'), onClick: () => actions.createBranch(name) },
          'separator',
          { label: t('sidebar.menu.deleteTag'), onClick: () => actions.deleteTag(name) }
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
