import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangedFile, CommitInfo } from '../../../shared/types'
import type { HistoryScope } from '../App'
import { useActions } from '../actions'
import { useBranchMenu } from '../branchMenu'
import type { MenuItem } from './ContextMenu'
import { useApp } from '../context'
import { endDrag, startDrag } from '../dnd'
import { errorMessage, fullDate, relativeDate, shortSha, statusLabel } from '../format'
import { startReorder, useOrder } from '../reorder'
import { git } from '../git'
import { formatShortDateTime, getCurrentLocale, t, type MessageKey } from '../i18n'
import { graphFor, laneColor, matchesCommit, refName, type GraphRow } from '../graph'
import { useDrop } from '../useDrop'

const ROW = 30
const LANE = 14
/** Distância do início da linha até o grafo: margem + botão ▸ + espaçamento (ver .row-toggle). */
const GRAPH_OFFSET = 30

/** Colunas do histórico; o usuário as reordena arrastando o cabeçalho. */
type Column = 'graph' | 'subject' | 'author' | 'date' | 'sha'
const COLUMNS: readonly Column[] = ['graph', 'subject', 'author', 'date', 'sha']
const COLUMN_LABELS: Record<Column, MessageKey> = {
  graph: 'history.columns.graph',
  subject: 'history.columns.subject',
  author: 'history.columns.author',
  date: 'history.columns.date',
  sha: 'history.columns.sha'
}

/** Id do campo de pesquisa (o atalho de teclado leva o foco para ele). */
export const HISTORY_SEARCH_ID = 'history-search'

interface Props {
  scope: HistoryScope
  onScope(scope: HistoryScope): void
  selected: string[]
  onSelect(shas: string[]): void
  /** Abre o diff de um arquivo do commit no painel de detalhes. */
  onOpenFile(sha: string, path: string): void
  /** Abre só o diff do arquivo, numa janela própria (duplo clique). */
  onOpenFileWindow(sha: string, path: string): void
}

type FilesState = ChangedFile[] | 'loading' | { error: string }

export function CommitList({ scope, onScope, selected, onSelect, onOpenFile, onOpenFileWindow }: Props) {
  const { data, showMenu, openStudio, openCompare, openRebase } = useApp()
  const actions = useActions()
  const anchor = useRef<number | null>(null)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [files, setFiles] = useState<Map<string, FilesState>>(new Map())
  const [columns, moveColumn] = useOrder('history.columns', COLUMNS)
  /** As trilhas do grafo só continuam ao lado dos arquivos expandidos quando o grafo é a primeira coluna. */
  const graphFirst = columns[0] === 'graph'
  const locale = getCurrentLocale()
  const commits = data.log
  const rows = graphFor(commits, data.status.headSha)
  const lanes = Math.max(1, ...rows.map((r) => Math.max(r.lanesIn.length, r.lanesOut.length, r.column + 1)))
  const graphWidth = Math.min(lanes, 12) * LANE + 8
  const selectedSet = new Set(selected)
  const searching = query.trim() !== ''
  /** Índices (em `commits`) das linhas visíveis — todas, ou só as que batem com a pesquisa. */
  const visible = useMemo(
    () => (searching ? commits.flatMap((c, i) => (matchesCommit(c, query, locale) ? [i] : [])) : commits.map((_, i) => i)),
    [commits, query, searching, locale]
  )

  // Arquivos dos commits expandidos são carregados sob demanda (e recarregados se o histórico mudar).
  useEffect(() => setFiles(new Map()), [commits])
  useEffect(() => {
    for (const sha of expanded) {
      if (files.has(sha)) continue
      setFiles((prev) => new Map(prev).set(sha, 'loading'))
      git.commitDetails(sha).then(
        (d) => setFiles((prev) => new Map(prev).set(sha, d.files)),
        (e) => setFiles((prev) => new Map(prev).set(sha, { error: errorMessage(e) }))
      )
    }
  }, [expanded, files])

  const toggle = (sha: string, open = !expanded.has(sha)) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (open) next.add(sha)
      else next.delete(sha)
      return next
    })

  const click = (e: React.MouseEvent, pos: number) => {
    const sha = commits[visible[pos]].sha
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [anchor.current, pos].sort((x, y) => x - y)
      onSelect(visible.slice(a, b + 1).map((i) => commits[i].sha))
      return
    }
    anchor.current = pos
    if (e.metaKey || e.ctrlKey) onSelect(selectedSet.has(sha) ? selected.filter((s) => s !== sha) : [...selected, sha])
    else onSelect([sha])
  }

  // ↑/↓ move a seleção (com Shift, estende a partir da âncora); → abre e ← fecha os arquivos do commit.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!visible.length) return
    const lastSha = selected[selected.length - 1]
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (!lastSha) return
      e.preventDefault()
      const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
      toggle(lastSha, (e.key === 'ArrowRight') !== rtl)
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const last = lastSha ? visible.findIndex((i) => commits[i].sha === lastSha) : -1
    const next = Math.max(0, Math.min(visible.length - 1, last + (e.key === 'ArrowDown' ? 1 : -1)))
    const nextSha = commits[visible[next]].sha
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [anchor.current, next].sort((x, y) => x - y)
      const range = visible.slice(a, b + 1).map((i) => commits[i].sha)
      // Mantém o item "ativo" por último para a próxima seta partir dele.
      onSelect([...range.filter((s) => s !== nextSha), nextSha])
    } else {
      anchor.current = next
      onSelect([nextSha])
    }
    document.querySelectorAll('.commit-row')[next]?.scrollIntoView({ block: 'nearest' })
  }

  const dragShas = (commit: CommitInfo) => (selectedSet.has(commit.sha) ? commits.filter((c) => selectedSet.has(c.sha)).map((c) => c.sha) : [commit.sha])

  /** Branches que apontam para o commit: as locais primeiro, depois as remotas. */
  const branchesAt = (commit: CommitInfo) => {
    const names = new Set(commit.refs.filter((r) => r !== 'HEAD' && !r.startsWith('tag: ')).map(refName))
    const list = data.branches.filter((b) => names.has(b.name))
    return [...list.filter((b) => !b.remote), ...list.filter((b) => b.remote)]
  }

  const menu = (e: React.MouseEvent, commit: CommitInfo) => {
    const shas = dragShas(commit)
    const head = actions.head
    // O checkout vem primeiro: das branches deste commit e, por último, do próprio commit (HEAD destacado).
    const checkouts: MenuItem[] = [
      ...branchesAt(commit).map((b) => ({
        label: b.remote ? t('sidebar.menu.checkoutRemote', { branch: b.name }) : t('sidebar.menu.checkoutBranch', { branch: b.name }),
        onClick: () => actions.checkout(b.name),
        disabled: b.current
      })),
      { label: t('history.menu.checkout'), onClick: () => actions.checkout(commit.sha) }
    ]
    showMenu(e, [
      ...checkouts,
      'separator',
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
      { label: expanded.has(commit.sha) ? t('history.menu.hideFiles') : t('history.menu.showFiles'), onClick: () => toggle(commit.sha) },
      'separator',
      { label: t('history.menu.newBranch'), onClick: () => actions.createBranch(commit.sha) },
      { label: t('history.menu.newTag'), onClick: () => actions.createTag(commit.sha) },
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
        <div className="search-box">
          <span className="search-icon">⌕</span>
          <input
            id={HISTORY_SEARCH_ID}
            type="search"
            value={query}
            placeholder={t('history.search.placeholder')}
            title={t('history.search.help')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation()
                setQuery('')
              } else if ((e.key === 'Enter' || e.key === 'ArrowDown') && visible.length) {
                e.preventDefault()
                anchor.current = 0
                onSelect([commits[visible[0]].sha])
                document.querySelector<HTMLElement>('.commit-list .list-body')?.focus()
              }
            }}
          />
        </div>
        <span className="muted">
          {searching ? t('history.search.found', { count: visible.length, total: commits.length }) : t('history.count', { count: commits.length })}
          {selected.length > 1 && ` · ${t('history.selected', { count: selected.length })}`}
        </span>
        <span className="muted hint">{t('history.hint')}</span>
      </div>
      <div className="commit-columns" title={t('history.columns.help')}>
        <span className="row-toggle" />
        {columns.map((column) => (
          <span
            key={column}
            className={`commit-column-head ${COLUMN_CLASS[column]}`}
            style={column === 'graph' ? { width: searching ? x(0) + 8 : graphWidth, flex: 'none' } : undefined}
            data-reorder="history-columns"
            data-reorder-id={column}
            onPointerDown={(e) => startReorder(e, 'history-columns', column, (a, b) => moveColumn(a as Column, b as Column))}
          >
            {t(COLUMN_LABELS[column])}
          </span>
        ))}
      </div>
      <div className="list-body" tabIndex={0} onKeyDown={onKeyDown}>
        {commits.length === 0 && <p className="empty">{t('history.empty')}</p>}
        {searching && commits.length > 0 && visible.length === 0 && <p className="empty">{t('history.search.none', { query })}</p>}
        {visible.map((index, pos) => {
          const commit = commits[index]
          const row = rows[index]
          const open = expanded.has(commit.sha)
          return (
            <Fragment key={commit.sha}>
              <div
                className={`commit-row ${selectedSet.has(commit.sha) ? 'selected' : ''} ${open ? 'expanded' : ''}`}
                onClick={(e) => click(e, pos)}
                onDoubleClick={() => toggle(commit.sha)}
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
                <button
                  className="row-toggle"
                  title={open ? t('history.menu.hideFiles') : t('history.menu.showFiles')}
                  aria-expanded={open}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(commit.sha)
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  {open ? '▾' : '▸'}
                </button>
                {columns.map((column) => {
                  switch (column) {
                    case 'graph':
                      return <GraphCell key={column} row={row} commit={commit} width={graphWidth} dotOnly={searching} />
                    case 'subject':
                      return (
                        <div key={column} className="commit-main">
                          <RefBadges refs={commit.refs} color={row.color} onScope={onScope} />
                          <span className="commit-subject">
                            <Highlight text={commit.subject} query={query} />
                          </span>
                        </div>
                      )
                    case 'author':
                      return (
                        <span key={column} className="commit-author">
                          <Highlight text={commit.author} query={query} />
                        </span>
                      )
                    case 'date':
                      return (
                        <span key={column} className="commit-date" title={`${fullDate(commit.date)}\n${relativeDate(commit.date)}`}>
                          <Highlight text={formatShortDateTime(commit.date)} query={query} />
                        </span>
                      )
                    case 'sha':
                      return (
                        <code key={column} className="commit-sha">
                          {shortSha(commit.sha)}
                        </code>
                      )
                  }
                })}
              </div>
              {open && (
                <CommitFiles
                  sha={commit.sha}
                  files={files.get(commit.sha) ?? 'loading'}
                  row={row}
                  graphWidth={graphWidth}
                  showLanes={!searching && graphFirst}
                  indent={graphFirst}
                  onOpenFile={(path) => onOpenFile(commit.sha, path)}
                  onOpenFileWindow={(path) => onOpenFileWindow(commit.sha, path)}
                />
              )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

/** Marca no texto os trechos que batem com a pesquisa. */
function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return <>{text}</>
  const lower = text.toLowerCase()
  const marks = new Array<boolean>(text.length).fill(false)
  for (const term of terms) {
    for (let i = lower.indexOf(term); i !== -1; i = lower.indexOf(term, i + 1)) marks.fill(true, i, i + term.length)
  }
  const parts: { text: string; mark: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1]
    if (last && last.mark === marks[i]) last.text += text[i]
    else parts.push({ text: text[i], mark: marks[i] })
  }
  return <>{parts.map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : <Fragment key={i}>{p.text}</Fragment>))}</>
}

const x = (lane: number) => LANE / 2 + lane * LANE + 4

const COLUMN_CLASS: Record<Column, string> = {
  graph: 'commit-graph-head',
  subject: 'commit-main',
  author: 'commit-author',
  date: 'commit-date',
  sha: 'commit-sha'
}

function curve(x1: number, y1: number, x2: number, y2: number) {
  if (x1 === x2) return `M${x1} ${y1}L${x2} ${y2}`
  const my = (y1 + y2) / 2
  return `M${x1} ${y1}C${x1} ${my} ${x2} ${my} ${x2} ${y2}`
}

function GraphCell({ row, commit, width, dotOnly }: { row: GraphRow; commit: CommitInfo; width: number; dotOnly: boolean }) {
  const mid = ROW / 2
  const col = row.column
  const color = laneColor(row.color)
  const merge = commit.parents.length > 1
  const paths: { d: string; color: string }[] = []
  if (!dotOnly) {
    row.lanesIn.forEach((v, i) => {
      if (!v) return
      if (v === row.sha) paths.push({ d: curve(x(i), 0, x(col), mid), color: laneColor(row.colorsIn[i]) })
      else {
        const j = row.lanesOut[i] === v ? i : row.lanesOut.indexOf(v)
        if (j >= 0) paths.push({ d: curve(x(i), 0, x(j), ROW), color: laneColor(row.colorsIn[i]) })
      }
    })
    commit.parents.forEach((p, n) => {
      const j = n === 0 ? col : row.lanesOut.indexOf(p)
      if (j >= 0) paths.push({ d: curve(x(col), mid, x(j), ROW), color: laneColor(row.colorsOut[j]) })
    })
  }
  const cx = dotOnly ? x(0) : x(col)
  return (
    <svg className="graph" width={dotOnly ? x(0) + 8 : width} height={ROW}>
      {paths.map((p, i) => (
        <path key={i} d={p.d} stroke={p.color} strokeWidth={2} fill="none" />
      ))}
      <circle cx={cx} cy={mid} r={merge ? 3.5 : 4.5} fill={merge ? 'var(--bg)' : color} stroke={color} strokeWidth={2} />
    </svg>
  )
}

/** Arquivos do commit, abertos logo abaixo da linha dele (as trilhas do grafo continuam ao lado). */
function CommitFiles({
  sha,
  files,
  row,
  graphWidth,
  showLanes,
  indent,
  onOpenFile,
  onOpenFileWindow
}: {
  sha: string
  files: FilesState
  row: GraphRow
  graphWidth: number
  showLanes: boolean
  /** Recua a lista até depois do grafo (quando ele é a primeira coluna). */
  indent: boolean
  onOpenFile(path: string): void
  onOpenFileWindow(path: string): void
}) {
  const { showMenu, openFileView, openInEditor } = useApp()
  const actions = useActions()
  const head = actions.head
  const pathsOf = (f: ChangedFile) => (f.oldPath ? [f.path, f.oldPath] : [f.path])

  const menu = (e: React.MouseEvent, file: ChangedFile) =>
    showMenu(e, [
      { label: t('history.files.openDiff'), onClick: () => onOpenFile(file.path) },
      { label: t('history.files.openWindow'), onClick: () => onOpenFileWindow(file.path) },
      ...(head ? [{ label: t('history.files.take', { target: head }), onClick: () => actions.filesOntoBranch(sha, pathsOf(file), head) }] : []),
      { label: t('common.blameHistory'), onClick: () => openFileView(file.path) },
      { label: t('common.openInEditor'), onClick: () => openInEditor(file.path) },
      'separator',
      { label: t('history.files.copyPath'), onClick: () => navigator.clipboard.writeText(file.path) }
    ])

  return (
    <div className="commit-files">
      <svg className="graph-continue" width={graphWidth} height="100%" style={{ insetInlineStart: GRAPH_OFFSET }} aria-hidden>
        {showLanes &&
          row.lanesOut.map((v, i) =>
            v ? <line key={i} x1={x(i)} x2={x(i)} y1="0" y2="100%" stroke={laneColor(row.colorsOut[i])} strokeWidth={2} /> : null
          )}
      </svg>
      <ul style={{ paddingInlineStart: indent ? GRAPH_OFFSET + graphWidth + 8 : GRAPH_OFFSET }}>
        {files === 'loading' ? (
          <li className="muted">
            <span className="spinner" />
          </li>
        ) : 'error' in files ? (
          <li className="warning-text">{files.error}</li>
        ) : files.length === 0 ? (
          <li className="muted">{t('history.files.none')}</li>
        ) : (
          files.map((file) => {
            const slash = file.path.lastIndexOf('/')
            return (
              <li
                key={file.path}
                className="commit-file"
                title={`${file.oldPath ? `${file.oldPath} → ` : ''}${file.path}\n${t('history.files.help')}`}
                onClick={() => onOpenFile(file.path)}
                onDoubleClick={() => onOpenFileWindow(file.path)}
                onContextMenu={(e) => menu(e, file)}
                draggable
                onDragStart={(e) => {
                  e.stopPropagation()
                  startDrag(e, { type: 'commit-files', sha, paths: pathsOf(file) }, `📄 ${file.path}`)
                }}
                onDragEnd={endDrag}
              >
                <span className={`status status-${file.status}`} title={statusLabel(file.status)}>
                  {file.status}
                </span>
                <span className="commit-file-name">{file.path.slice(slash + 1)}</span>
                {slash > 0 && <span className="commit-file-dir">{file.path.slice(0, slash)}</span>}
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}

function RefBadges({ refs, color, onScope }: { refs: string[]; color: number; onScope(scope: HistoryScope): void }) {
  if (!refs.length) return null
  return (
    <>
      {refs.map((ref) => {
        if (ref === 'HEAD') return <span key={ref} className="ref ref-head">HEAD</span>
        if (ref.startsWith('HEAD -> ')) return <BranchBadge key={ref} name={ref.slice(8)} color={color} onScope={onScope} current />
        if (ref.startsWith('tag: ')) return <span key={ref} className="ref ref-tag">⌂ {ref.slice(5)}</span>
        return <BranchBadge key={ref} name={ref} color={color} onScope={onScope} />
      })}
    </>
  )
}

/**
 * Etiqueta de branch no histórico, na cor da trilha dela: pode ser arrastada, recebe itens soltos e
 * tem o menu da branch no botão direito (o checkout leva para a branch, não para um HEAD destacado).
 */
function BranchBadge({ name, color, onScope, current = false }: { name: string; color: number; onScope(scope: HistoryScope): void; current?: boolean }) {
  const { data, showMenu } = useApp()
  const actions = useActions()
  const branchMenu = useBranchMenu(onScope)
  const branch = data.branches.find((b) => b.name === name)
  const remote = !!branch?.remote
  const drop = useDrop(
    (p) => !remote && p.type !== 'files' && !(p.type === 'branch' && p.name === name),
    (p) => void actions.dropOnBranch(p, name)
  )
  return (
    <span
      className={`ref ${remote ? 'ref-remote' : 'ref-branch'} ${current ? 'ref-current' : ''} ${drop.over ? 'drop-over' : ''}`}
      style={{ '--ref-color': laneColor(color) } as React.CSSProperties}
      draggable
      onDragStart={(e) => {
        e.stopPropagation()
        startDrag(e, { type: 'branch', name, remote }, `⎇ ${name}`)
      }}
      onDragEnd={endDrag}
      onContextMenu={branch ? (e) => showMenu(e, branchMenu(branch)) : undefined}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (branch && !branch.current) void actions.checkout(name)
      }}
      title={`${current ? t('toolbar.currentBranch') : remote ? t('history.badge.remote') : t('history.badge.local')}\n${t('sidebar.branchTooltip')}`}
      {...drop.props}
    >
      {current ? '✓ ' : ''}
      {name}
    </span>
  )
}
