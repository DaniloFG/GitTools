import { useMemo, useRef } from 'react'
import type { CommitInfo } from '../../../shared/types'
import type { HistoryScope } from '../App'
import { useActions } from '../actions'
import { useApp } from '../context'
import { endDrag, startDrag } from '../dnd'
import { fullDate, relativeDate, shortSha } from '../format'
import { t } from '../i18n'
import { computeGraph, laneColor, type GraphRow } from '../graph'
import { useDrop } from '../useDrop'

const ROW = 30
const LANE = 14

interface Props {
  scope: HistoryScope
  onScope(scope: HistoryScope): void
  selected: string[]
  onSelect(shas: string[]): void
}

export function CommitList({ scope, onScope, selected, onSelect }: Props) {
  const { data, showMenu, openStudio, openCompare, openRebase } = useApp()
  const actions = useActions()
  const anchor = useRef<number | null>(null)
  const commits = data.log
  const rows = useMemo(() => computeGraph(commits), [commits])
  const lanes = Math.max(1, ...rows.map((r) => Math.max(r.lanesIn.length, r.lanesOut.length, r.column + 1)))
  const graphWidth = Math.min(lanes, 12) * LANE + 8
  const selectedSet = new Set(selected)

  const click = (e: React.MouseEvent, index: number) => {
    const sha = commits[index].sha
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [anchor.current, index].sort((x, y) => x - y)
      onSelect(commits.slice(a, b + 1).map((c) => c.sha))
      return
    }
    anchor.current = index
    if (e.metaKey || e.ctrlKey) onSelect(selectedSet.has(sha) ? selected.filter((s) => s !== sha) : [...selected, sha])
    else onSelect([sha])
  }

  // ↑/↓ move a seleção; com Shift, estende a partir da âncora.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    if (!commits.length) return
    e.preventDefault()
    const last = selected.length ? commits.findIndex((c) => c.sha === selected[selected.length - 1]) : -1
    const next = Math.max(0, Math.min(commits.length - 1, last + (e.key === 'ArrowDown' ? 1 : -1)))
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [anchor.current, next].sort((x, y) => x - y)
      const range = commits.slice(a, b + 1).map((c) => c.sha)
      // Mantém o item "ativo" por último para a próxima seta partir dele.
      onSelect([...range.filter((s) => s !== commits[next].sha), commits[next].sha])
    } else {
      anchor.current = next
      onSelect([commits[next].sha])
    }
    document.querySelectorAll('.commit-row')[next]?.scrollIntoView({ block: 'nearest' })
  }

  const dragShas = (commit: CommitInfo) => (selectedSet.has(commit.sha) ? commits.filter((c) => selectedSet.has(c.sha)).map((c) => c.sha) : [commit.sha])

  const menu = (e: React.MouseEvent, commit: CommitInfo) => {
    const shas = dragShas(commit)
    const head = actions.head
    showMenu(e, [
      ...(head
        ? [
            {
              label: t('history.menu.cherryPick', { count: shas.length, target: head }),
              onClick: () => actions.cherryPickCommits(head, shas, shas.length === 1 ? commit.subject : undefined)
            }
          ]
        : []),
      { label: t('history.menu.openStudio'), onClick: () => openStudio({ target: head ?? undefined, commits: shas, mode: 'commits' }) },
      ...(shas.length === 2
        ? [{ label: t('history.menu.compareTwo'), onClick: () => openCompare({ from: shas[1], to: shas[0] }) }]
        : [{ label: t('common.compareWith', { ref: head ?? 'HEAD' }), onClick: () => openCompare({ from: head ?? 'HEAD', to: commit.sha }) }]),
      ...(head ? [{ label: t('history.menu.rebase'), onClick: () => openRebase(commit.sha) }] : []),
      'separator',
      { label: t('history.menu.newBranch'), onClick: () => actions.createBranch(commit.sha) },
      { label: t('history.menu.checkout'), onClick: () => actions.checkout(commit.sha) },
      'separator',
      { label: t('history.menu.revert'), onClick: () => actions.revert(commit) },
      { label: t('history.menu.reset', { branch: head ?? 'HEAD' }), onClick: () => actions.reset(commit) },
      'separator',
      { label: t('history.menu.copySha'), onClick: () => navigator.clipboard.writeText(commit.sha) }
    ])
  }

  return (
    <div className="commit-list">
      <div className="list-header">
        <select
          value={scope.kind === 'ref' ? `ref:${scope.ref}` : scope.kind}
          onChange={(e) => {
            const v = e.target.value
            onScope(v === 'all' ? { kind: 'all' } : v === 'head' ? { kind: 'head' } : { kind: 'ref', ref: v.slice(4) })
          }}
        >
          <option value="all">{t('history.scope.all')}</option>
          <option value="head">{t('history.scope.head')}</option>
          {scope.kind === 'ref' && <option value={`ref:${scope.ref}`}>{t('history.scope.ref', { ref: scope.ref })}</option>}
        </select>
        <span className="muted">
          {t('history.count', { count: commits.length })}
          {selected.length > 1 && ` · ${t('history.selected', { count: selected.length })}`}
        </span>
        <span className="muted hint">{t('history.hint')}</span>
      </div>
      <div className="list-body" tabIndex={0} onKeyDown={onKeyDown}>
        {commits.length === 0 && <p className="empty">{t('history.empty')}</p>}
        {commits.map((commit, i) => (
          <div
            key={commit.sha}
            className={`commit-row ${selectedSet.has(commit.sha) ? 'selected' : ''}`}
            onClick={(e) => click(e, i)}
            onContextMenu={(e) => menu(e, commit)}
            draggable
            onDragStart={(e) => {
              const shas = dragShas(commit)
              startDrag(
                e,
                { type: 'commits', shas, subject: shas.length === 1 ? commit.subject : undefined },
                shas.length > 1 ? `🍒 ${t('history.count', { count: shas.length })}` : `🍒 ${shortSha(commit.sha)} ${commit.subject}`
              )
            }}
            onDragEnd={endDrag}
          >
            <GraphCell row={rows[i]} commit={commit} width={graphWidth} />
            <div className="commit-main">
              <RefBadges refs={commit.refs} />
              <span className="commit-subject">{commit.subject}</span>
            </div>
            <span className="commit-author">{commit.author}</span>
            <span className="commit-date" title={fullDate(commit.date)}>
              {relativeDate(commit.date)}
            </span>
            <code className="commit-sha">{shortSha(commit.sha)}</code>
          </div>
        ))}
      </div>
    </div>
  )
}

const x = (lane: number) => LANE / 2 + lane * LANE + 4

function curve(x1: number, y1: number, x2: number, y2: number) {
  if (x1 === x2) return `M${x1} ${y1}L${x2} ${y2}`
  const my = (y1 + y2) / 2
  return `M${x1} ${y1}C${x1} ${my} ${x2} ${my} ${x2} ${y2}`
}

function GraphCell({ row, commit, width }: { row: GraphRow; commit: CommitInfo; width: number }) {
  const mid = ROW / 2
  const col = row.column
  const paths: { d: string; color: string }[] = []
  row.lanesIn.forEach((v, i) => {
    if (!v) return
    if (v === row.sha) paths.push({ d: curve(x(i), 0, x(col), mid), color: laneColor(i) })
    else {
      const j = row.lanesOut[i] === v ? i : row.lanesOut.indexOf(v)
      if (j >= 0) paths.push({ d: curve(x(i), 0, x(j), ROW), color: laneColor(i) })
    }
  })
  commit.parents.forEach((p, n) => {
    const j = n === 0 ? col : row.lanesOut.indexOf(p)
    if (j >= 0) paths.push({ d: curve(x(col), mid, x(j), ROW), color: laneColor(n === 0 ? col : j) })
  })
  const merge = commit.parents.length > 1
  return (
    <svg className="graph" width={width} height={ROW}>
      {paths.map((p, i) => (
        <path key={i} d={p.d} stroke={p.color} strokeWidth={2} fill="none" />
      ))}
      <circle cx={x(col)} cy={mid} r={merge ? 3.5 : 4.5} fill={merge ? 'var(--bg)' : laneColor(col)} stroke={laneColor(col)} strokeWidth={2} />
    </svg>
  )
}

function RefBadges({ refs }: { refs: string[] }) {
  if (!refs.length) return null
  return (
    <>
      {refs.map((ref) => {
        if (ref === 'HEAD') return <span key={ref} className="ref ref-head">HEAD</span>
        if (ref.startsWith('HEAD -> ')) return <BranchBadge key={ref} name={ref.slice(8)} current />
        if (ref.startsWith('tag: ')) return <span key={ref} className="ref ref-tag">⌂ {ref.slice(5)}</span>
        return <BranchBadge key={ref} name={ref} />
      })}
    </>
  )
}

/** Etiqueta de branch no histórico: pode ser arrastada e também recebe itens soltos. */
function BranchBadge({ name, current = false }: { name: string; current?: boolean }) {
  const { data } = useApp()
  const actions = useActions()
  const branch = data.branches.find((b) => b.name === name)
  const remote = !!branch?.remote
  const drop = useDrop(
    (p) => !remote && p.type !== 'files' && !(p.type === 'branch' && p.name === name),
    (p) => void actions.dropOnBranch(p, name)
  )
  return (
    <span
      className={`ref ${remote ? 'ref-remote' : 'ref-branch'} ${current ? 'ref-current' : ''} ${drop.over ? 'drop-over' : ''}`}
      draggable
      onDragStart={(e) => {
        e.stopPropagation()
        startDrag(e, { type: 'branch', name, remote }, `⎇ ${name}`)
      }}
      onDragEnd={endDrag}
      title={current ? t('toolbar.currentBranch') : remote ? t('history.badge.remote') : t('history.badge.local')}
      {...drop.props}
    >
      {current ? '● ' : ''}
      {name}
    </span>
  )
}
