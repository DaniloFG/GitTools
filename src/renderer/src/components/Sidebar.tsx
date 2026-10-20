import { useState, type ReactNode } from 'react'
import type { BranchInfo, StashInfo } from '../../../shared/types'
import type { HistoryScope } from '../App'
import { useActions } from '../actions'
import { useApp } from '../context'
import { endDrag, startDrag } from '../dnd'
import { git } from '../git'
import { relativeDate } from '../format'
import { useDrop } from '../useDrop'

interface Props {
  scope: HistoryScope
  onScope(scope: HistoryScope): void
}

export function Sidebar({ scope, onScope }: Props) {
  const { data } = useApp()
  const local = data.branches.filter((b) => !b.remote)
  const remotes = new Map<string, BranchInfo[]>()
  for (const b of data.branches.filter((b) => b.remote)) {
    remotes.set(b.remote!, [...(remotes.get(b.remote!) ?? []), b])
  }

  return (
    <aside className="sidebar">
      <p className="sidebar-hint">Arraste uma branch, commit ou arquivo sobre uma branch local para merge, rebase ou cherry-pick.</p>
      <Section title="Branches" count={local.length}>
        {local.map((b) => (
          <BranchItem key={b.fullRef} branch={b} active={scope.kind === 'ref' && scope.ref === b.name} onScope={onScope} />
        ))}
      </Section>
      {[...remotes.entries()].map(([remote, list]) => (
        <Section key={remote} title={`Remoto: ${remote}`} count={list.length} collapsed>
          {list.map((b) => (
            <BranchItem key={b.fullRef} branch={b} active={scope.kind === 'ref' && scope.ref === b.name} onScope={onScope} />
          ))}
        </Section>
      ))}
      <Section title="Tags" count={data.tags.length} collapsed>
        {data.tags.map((t) => (
          <TagItem key={t.name} name={t.name} sha={t.sha} />
        ))}
      </Section>
      <Section title="Stashes" count={data.stashes.length}>
        {data.stashes.map((s) => (
          <StashItem key={s.ref} stash={s} />
        ))}
      </Section>
    </aside>
  )
}

function Section({ title, count, children, collapsed = false }: { title: string; count: number; children: ReactNode; collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed)
  return (
    <section className="sidebar-section">
      <button className="section-header" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'}</span> {title} <span className="count">{count}</span>
      </button>
      {open && <ul>{children}</ul>}
    </section>
  )
}

function BranchItem({ branch, active, onScope }: { branch: BranchInfo; active: boolean; onScope(s: HistoryScope): void }) {
  const { showMenu, run, openStudio, openCompare } = useApp()
  const actions = useActions()
  const isRemote = !!branch.remote
  const drop = useDrop(
    (p) => !isRemote && !(p.type === 'branch' && p.name === branch.name) && p.type !== 'files',
    (p) => void actions.dropOnBranch(p, branch.name)
  )
  const head = actions.head

  const menu = (e: React.MouseEvent) =>
    showMenu(e, [
      { label: 'Checkout', onClick: () => actions.checkout(branch.name), disabled: branch.current },
      { label: 'Ver histórico desta branch', onClick: () => onScope({ kind: 'ref', ref: branch.name }) },
      'separator',
      ...(head && !branch.current
        ? [
            { label: `Merge de ${branch.name} em ${head}`, onClick: () => run('Merge', () => git.merge(branch.name, head)) },
            ...(isRemote ? [] : [{ label: `Rebase de ${head} sobre ${branch.name}`, onClick: () => run('Rebase', () => git.rebase(head, branch.name)) }]),
            {
              label: `Cherry-pick de todos os commits em ${head}…`,
              onClick: () => actions.branchOntoBranch(branch.name, head, isRemote)
            }
          ]
        : []),
      ...(head && !branch.current ? [{ label: `Comparar com ${head}`, onClick: () => openCompare({ from: head, to: branch.name }) }] : []),
      { label: 'Cherry-pick Studio (origem = esta branch)…', onClick: () => openStudio({ source: branch.name, target: head ?? undefined }) },
      'separator',
      { label: 'Nova branch a partir desta…', onClick: () => actions.createBranch(branch.name) },
      ...(isRemote
        ? []
        : [
            { label: 'Renomear…', onClick: () => actions.renameBranch(branch) },
            { label: 'Excluir…', onClick: () => actions.deleteBranch(branch), danger: true, disabled: branch.current }
          ])
    ])

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
      title={`${branch.name}\n${branch.subject}\n${relativeDate(branch.date)}\n\nDuplo clique: checkout · Botão direito: mais ações`}
      {...drop.props}
    >
      <span className="branch-icon">{branch.current ? '●' : '⎇'}</span>
      <span className="branch-name">{label}</span>
      {(branch.ahead > 0 || branch.behind > 0) && (
        <span className="track">
          {branch.ahead > 0 && `↑${branch.ahead}`}
          {branch.behind > 0 && ` ↓${branch.behind}`}
        </span>
      )}
      {drop.over && <span className="drop-hint">soltar aqui</span>}
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
          { label: 'Checkout (HEAD destacado)', onClick: () => actions.checkout(name) },
          { label: 'Nova branch a partir desta tag…', onClick: () => actions.createBranch(name) }
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
    const ok = await confirm({ title: 'Descartar stash', message: `Descartar "${stash.message}"?`, confirmLabel: 'Descartar', danger: true })
    if (ok) await run('Descartando stash', () => git.stashDrop(stash.index))
  }
  return (
    <li className="stash-item" title={`${stash.ref} · ${relativeDate(stash.date)}`}>
      <span className="branch-name">{stash.message}</span>
      <span className="stash-actions">
        <button onClick={() => run('Aplicando stash', () => git.stashApply(stash.index, true))} title="Aplicar e remover (pop)">
          ⤓
        </button>
        <button onClick={() => run('Aplicando stash', () => git.stashApply(stash.index))} title="Aplicar e manter">
          ⧉
        </button>
        <button onClick={drop} title="Descartar">
          ✕
        </button>
      </span>
    </li>
  )
}
