import { Fragment, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { BranchInfo, ChangedFile, CommitInfo } from '../../../shared/types'
import { LOG_MAX, showsWorkingChanges, type HistoryScope } from '../historyScope'
import { useActions } from '../actions'
import { useBranchMenu } from '../branchMenu'
import type { MenuItem } from './ContextMenu'
import { buildEntries, sumStats, type ChangeEntry } from '../changeEntries'
import { useAppActions, useRepoData } from '../context'
import { copyText } from '../copy'
import { endDrag, startDrag, type DragPayload } from '../dnd'
import { errorMessage, fullDate, relativeDate, shortSha, statusLabel } from '../format'
import { startReorder, useOrder } from '../reorder'
import { useLayout } from '../layout'
import { startResize } from '../resize'
import { git } from '../git'
import { dateFormatKey, formatGridDateTime, getCurrentLocale, t, type MessageKey } from '../i18n'
import { graphFor, laneColor, matchesCommit, refName, type GraphRow } from '../graph'
import { useDrop } from '../useDrop'
import { FileEntries } from './FileList'
import { FileViewOptions } from './ViewOptions'
import { LineStats } from './LineStats'
import type { FileStatus } from '../../../shared/types'
import { Loader } from './Loader'
import { VirtualList, type VirtualListHandle } from './VirtualList'

const ROW = 30
const LANE = 14
/**
 * Margem montada acima e abaixo da área visível (cerca de 10 linhas de cada lado). Só o que está na tela
 * e nessa margem fica no DOM: rolar não acumula linhas, e cada arrasto de divisória refaz pouco layout.
 */
const OVERSCAN = 300
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

/** Colunas de largura fixa (a do assunto ocupa o resto); o usuário ajusta arrastando a borda do título. */
type SizedColumn = 'author' | 'date' | 'sha'
type ColumnWidths = Record<SizedColumn, number>
const DEFAULT_WIDTHS: ColumnWidths = { author: 140, date: 152, sha: 76 }
const MIN_WIDTH = 44
const MAX_WIDTH = 480
const isSized = (c: Column): c is SizedColumn => c === 'author' || c === 'date' || c === 'sha'

function parseWidths(value: unknown): ColumnWidths {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const pick = (key: SizedColumn) =>
    typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw[key] as number)) : DEFAULT_WIDTHS[key]
  return { author: pick('author'), date: pick('date'), sha: pick('sha') }
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
  /** Abre o diff de um arquivo ainda não commitado no painel de detalhes. */
  onOpenWipFile(path: string): void
  /** Há commits além dos carregados (e o teto não foi atingido): o rodapé pede mais uma página. */
  canLoadMore: boolean
  /** Lê a página seguinte do histórico (o rodapé chama quando se aproxima da área visível). */
  onLoadMore(): void
}

type FilesState = ChangedFile[] | 'loading' | { error: string }

export function CommitList({
  scope,
  onScope,
  selected,
  onSelect,
  onOpenFile,
  onOpenFileWindow,
  onOpenWipFile,
  canLoadMore,
  onLoadMore
}: Props) {
  // Dados e abas vêm da fatia de dados; as funções, da fatia de ações (estável): a lista não redesenha com a operação.
  const { data, repo, workspace } = useRepoData()
  const { showMenu, openStudio, openCompare, openRebase, setView, openConflict, openDiffWindow } = useAppActions()
  const actions = useActions()
  const anchor = useRef<number | null>(null)
  // Menu da branch (botão direito na etiqueta): as etiquetas não chamam useBranchMenu, quem o chama é este componente.
  const branchItemsOf = useBranchMenu(onScope)
  const [query, setQuery] = useState('')
  /** A pesquisa filtra a lista com um pequeno atraso, para a digitação não travar em históricos grandes. */
  const deferredQuery = useDeferredValue(query)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [files, setFiles] = useState<Map<string, FilesState>>(new Map())
  const [columns, moveColumn] = useOrder('history.columns', COLUMNS)
  const [widths, setWidths] = useLayout<ColumnWidths>('history.columnWidths', parseWidths)
  /** As trilhas do grafo só continuam ao lado dos arquivos expandidos quando o grafo é a primeira coluna. */
  const graphFirst = columns[0] === 'graph'
  const locale = getCurrentLocale()
  const commits = data.log
  const rows = graphFor(commits, data.status.headSha)
  const graphWidth = useMemo(() => {
    const lanes = rows.reduce((max, r) => Math.max(max, r.lanesIn.length, r.lanesOut.length, r.column + 1), 1)
    return Math.max(52, Math.min(lanes, 12) * LANE + 8)
  }, [rows])
  const searching = deferredQuery.trim() !== ''
  /**
   * Mesmas colunas no cabeçalho e em cada linha (grid): nenhuma invade a outra; o assunto ocupa o que
   * sobra e os textos longos terminam em "…". Larguras zeradas (lista estreita) escondem a coluna.
   */
  const template = [
    'var(--toggle-width)',
    ...columns.map((c) => (c === 'graph' ? `${searching ? x(0) + 8 : graphWidth}px` : c === 'subject' ? 'minmax(80px, 1fr)' : `var(--w-${c})`))
  ].join(' ')
  const listStyle = {
    '--user-author': `${widths.author}px`,
    '--user-date': `${widths.date}px`,
    '--user-sha': `${widths.sha}px`
  } as React.CSSProperties

  /** Arrastar a borda de uma coluna: a borda virada para o assunto é a que se move. */
  const resizeColumn = (e: React.PointerEvent, column: SizedColumn) => {
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
    const afterSubject = columns.indexOf(column) > columns.indexOf('subject')
    const start = widths[column]
    startResize(e, 'col-resize', (_event, dx) => {
      const delta = (rtl ? -dx : dx) * (afterSubject ? -1 : 1)
      setWidths((prev) => ({ ...prev, [column]: Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, start + delta))) }))
    })
  }
  const selectedSet = new Set(selected)
  /** Índices (em `commits`) das linhas visíveis — todas, ou só as que batem com a pesquisa. */
  const visible = useMemo(
    () => (searching ? commits.flatMap((c, i) => (matchesCommit(c, deferredQuery, locale) ? [i] : [])) : commits.map((_, i) => i)),
    [commits, deferredQuery, searching, locale]
  )
  const listRef = useRef<VirtualListHandle>(null)
  /** A linha de alterações é do HEAD: só aparece vendo tudo, o HEAD ou a branch atual. */
  const showWip = showsWorkingChanges(scope, actions.head)

  /**
   * Rodapé "carregando mais": um observador na lista (raiz = a própria janela de rolagem) pede a página seguinte
   * quando o rodapé chega perto da área visível. Durante a pesquisa não carrega: ela só filtra o que já está lá.
   */
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const onLoadMoreRef = useRef(onLoadMore)
  onLoadMoreRef.current = onLoadMore
  const showLoadMore = canLoadMore && !searching
  useEffect(() => {
    const el = loadMoreRef.current
    const root = listRef.current?.element
    if (!el || !root || !showLoadMore || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMoreRef.current()
      },
      { root, rootMargin: '600px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
    // Refaz o observador a cada página: um rodapé que continua à vista depois de uma página dispara de novo.
  }, [showLoadMore, commits.length]) // eslint-disable-line react-hooks/exhaustive-deps

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
    // O índice vem dos dados: a linha pode não estar montada, então o índice no DOM não serve para rolar.
    const list = listRef.current
    const onRow = e.target instanceof HTMLElement && (e.target.classList.contains('commit-row') || e.target === e.currentTarget)
    list?.scrollToIndex(next)
    // Com o foco numa linha (ou no contêiner), leva o foco para a linha nova: Ctrl+C copia o `data-copy` dela.
    if (onRow) {
      requestAnimationFrame(() => list?.element?.querySelector<HTMLElement>(`.commit-row[data-pos="${next}"]`)?.focus({ preventScroll: true }))
    }
  }

  /** Funções de sempre-atuais para as linhas, que ficam memorizadas e não podem depender delas diretamente. */
  const handlers = useRef({} as RowHandlers)
  const stableColumns = useMemo(() => columns, [columns.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const dateKey = dateFormatKey()

  // A janela pede chave e altura por posição em `visible`. Estáveis: cada mudança de identidade refaz as posições.
  const keyOf = useCallback((pos: number) => commits[visible[pos]].sha, [commits, visible])
  // Commit aberto (com os arquivos) é um item só, de altura medida.
  const isVariable = useCallback((pos: number) => expanded.has(commits[visible[pos]].sha), [commits, visible, expanded])

  const dragShas = (commit: CommitInfo) => (selectedSet.has(commit.sha) ? commits.filter((c) => selectedSet.has(c.sha)).map((c) => c.sha) : [commit.sha])

  /** Branches que apontam para o commit: as locais primeiro, depois as remotas. */
  const branchesAt = (commit: CommitInfo) => {
    const names = new Set(commit.refs.filter((r) => r !== 'HEAD' && !r.startsWith('tag: ')).map(refName))
    const list = data.branches.filter((b) => names.has(b.name))
    return [...list.filter((b) => !b.remote), ...list.filter((b) => b.remote)]
  }

  /**
   * Busca de branch por nome, num Map: cada etiqueta consulta a sua a cada desenho, e um `find` sobre 1.100
   * branches repetia a varredura em todas. O primeiro de cada nome vence, como o `find` fazia.
   */
  const branchByName = useMemo(() => {
    const map = new Map<string, BranchInfo>()
    for (const b of data.branches) if (!map.has(b.name)) map.set(b.name, b)
    return map
  }, [data.branches])
  /** Nomes de branches remotas: as etiquetas precisam disso para a classe e o arrasto; muda só com `data.branches`. */
  const remoteNames = useMemo(() => new Set([...branchByName.values()].filter((b) => b.remote).map((b) => b.name)), [branchByName])

  handlers.current = {
    click,
    toggle,
    menu: (e, commit) => menu(e, commit),
    dragShas,
    branchMenu: (e, name) => {
      const branch = branchByName.get(name)
      if (branch) showMenu(e, branchItemsOf(branch))
    },
    dropOnBranch: (payload, name) => void actions.dropOnBranch(payload, name),
    checkoutBranch: (name) => {
      const branch = branchByName.get(name)
      if (branch && !branch.current) void actions.checkout(name)
    }
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
    // Outros repositórios abertos: os commits vão para a branch atual deles (com confirmação, no nível do app).
    const otherRepos = workspace.repos.filter((r) => r.root !== repo.root)
    const summary = (root: string) => workspace.summaries[root]
    const branchOf = (root: string) => {
      const s = summary(root)
      if (!s) return '…'
      return s.detached ? (s.headSha?.slice(0, 7) ?? t('repoTabs.noBranch')) : (s.branch ?? t('repoTabs.noBranch'))
    }
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
      ...(otherRepos.length > 0
        ? [
            {
              label: t('repoTabs.applyAcross'),
              submenu: otherRepos.map((r) => ({
                label: `${r.name} (${branchOf(r.root)})`,
                onClick: () => workspace.applyAcross(repo.root, r.root, shas)
              }))
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
      ...(shas.length === 1 && commit.sha === data.status.headSha
        ? [{ label: t('history.menu.editMessage'), onClick: () => void actions.editHeadMessage(commit.sha) }]
        : []),
      'separator',
      actions.copyMessageMenu(shas)
    ])
  }

  return (
    <div className="commit-list" style={listStyle}>
      <div className="list-header">
        <select
          value={scope.kind === 'ref' ? `ref:${scope.ref}` : scope.kind}
          title={scope.kind === 'refs' ? scope.refs.join('\n') : undefined}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'refs') return
            onScope(v === 'all' ? { kind: 'all' } : v === 'head' ? { kind: 'head' } : { kind: 'ref', ref: v.slice(4) })
          }}
        >
          <option value="all">{t('history.scope.all')}</option>
          <option value="head">{t('history.scope.head')}</option>
          {scope.kind === 'ref' && <option value={`ref:${scope.ref}`}>{t('history.scope.ref', { ref: scope.ref })}</option>}
          {scope.kind === 'refs' && <option value="refs">{t('history.scope.refs', { count: scope.refs.length })}</option>}
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
                listRef.current?.scrollToIndex(0)
                listRef.current?.element?.focus()
              }
            }}
          />
        </div>
        <span className="muted">
          {searching ? t('history.search.found', { count: visible.length, total: commits.length }) : t('history.count', { count: commits.length })}
          {selected.length > 1 && ` · ${t('history.selected', { count: selected.length })}`}
        </span>
        <span className="log-chip" title={t('history.log.help')} tabIndex={0} aria-label={t('history.log.help')}>
          ⓘ <code>{t('history.log.chip')}</code>
        </span>
        <span className="muted hint">{t('history.hint')}</span>
        <FileViewOptions />
      </div>
      <div className="commit-columns" title={t('history.columns.help')} style={{ gridTemplateColumns: template }}>
        <span className="row-toggle" />
        {columns.map((column) => (
          <span
            key={column}
            className={`commit-column-head ${COLUMN_CLASS[column]} ${isSized(column) ? (columns.indexOf(column) > columns.indexOf('subject') ? 'resize-start' : 'resize-end') : ''}`}
            data-reorder="history-columns"
            data-reorder-id={column}
            onPointerDown={(e) => startReorder(e, 'history-columns', column, (a, b) => moveColumn(a as Column, b as Column))}
          >
            <span className="commit-column-label">{t(COLUMN_LABELS[column])}</span>
            {isSized(column) && (
              <span
                className="column-resize"
                role="separator"
                aria-orientation="vertical"
                title={t('workbench.resizeColumn')}
                onPointerDown={(e) => resizeColumn(e, column)}
                onDoubleClick={() => setWidths((prev) => ({ ...prev, [column]: DEFAULT_WIDTHS[column] }))}
              />
            )}
          </span>
        ))}
      </div>
      <VirtualList
        ref={listRef}
        className="list-body"
        tabIndex={0}
        onKeyDown={onKeyDown}
        count={visible.length}
        rowHeight={ROW}
        keyOf={keyOf}
        isVariable={isVariable}
        overscan={OVERSCAN}
        // A linha de alterações é sticky no topo: a rolagem por teclado não pode esconder o item atrás dela.
        stickyTop={showWip ? ROW : 0}
        footer={
          showLoadMore ? (
            <div className="history-more" ref={loadMoreRef}>
              <Loader size="sm" />
              <span>{t('history.loadingMore')}</span>
            </div>
          ) : !canLoadMore && commits.length >= LOG_MAX ? (
            <div className="history-more muted">{t('history.limitReached', { count: commits.length })}</div>
          ) : undefined
        }
        header={
          <>
            {showWip && (
              <WipRow
                status={data.status}
                template={template}
                columns={stableColumns}
                graphWidth={graphWidth}
                searching={searching}
                headRow={rows.find((r) => r.sha === data.status.headSha)}
                indent={graphFirst}
                onOpenChanges={() => setView('changes')}
                onOpenConflict={openConflict}
                onOpenFile={onOpenWipFile}
                onOpenDiff={(source, path, title) => openDiffWindow({ source, path, title })}
              />
            )}
            {commits.length === 0 && <p className="empty">{t('history.empty')}</p>}
            {searching && commits.length > 0 && visible.length === 0 && <p className="empty">{t('history.search.none', { query: deferredQuery })}</p>}
          </>
        }
        renderItem={(pos) => {
          const index = visible[pos]
          const commit = commits[index]
          const row = rows[index]
          const open = expanded.has(commit.sha)
          return (
            <>
              <CommitRow
                commit={commit}
                row={row}
                pos={pos}
                selected={selectedSet.has(commit.sha)}
                open={open}
                template={template}
                columns={stableColumns}
                graphWidth={graphWidth}
                searching={searching}
                query={searching ? deferredQuery : ''}
                handlers={handlers}
                dateKey={dateKey}
                remoteNames={remoteNames}
              />
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
            </>
          )
        }}
      />
    </div>
  )
}

interface RowHandlers {
  click(e: React.MouseEvent, pos: number): void
  toggle(sha: string, open?: boolean): void
  menu(e: React.MouseEvent, commit: CommitInfo): void
  dragShas(commit: CommitInfo): string[]
  /** Menu de botão direito de uma etiqueta de branch; nada se a branch não está na lista. */
  branchMenu(e: React.MouseEvent, name: string): void
  dropOnBranch(payload: DragPayload, name: string): void
  /** Checkout pelo duplo clique na etiqueta; não faz nada na branch atual. */
  checkoutBranch(name: string): void
}

interface RowProps {
  commit: CommitInfo
  row: GraphRow
  pos: number
  selected: boolean
  open: boolean
  template: string
  columns: readonly Column[]
  graphWidth: number
  searching: boolean
  query: string
  handlers: React.RefObject<RowHandlers>
  /** Muda com o formato de datas e o idioma: a linha é memorizada e precisa saber que deve se redesenhar. */
  dateKey: string
  remoteNames: ReadonlySet<string>
}

/**
 * Uma linha do histórico. Memorizada: clicar numa linha só redesenha a que perdeu e a que ganhou a
 * seleção, não as centenas de outras.
 */
const CommitRow = memo(function CommitRow({ commit, row, pos, selected, open, template, columns, graphWidth, searching, query, handlers, remoteNames }: RowProps) {
  // `dateKey` só existe para invalidar a memorização; a data é escrita pelas funções de formato.
  return (
    <div
      className={`commit-row ${selected ? 'selected' : ''} ${open ? 'expanded' : ''}`}
      style={{ gridTemplateColumns: template }}
      tabIndex={-1}
      data-pos={pos}
      data-copy={commit.subject}
      data-copy-what="message"
      onClick={(e) => handlers.current.click(e, pos)}
      onDoubleClick={(e) => {
        // Duplo clique num texto da linha seleciona a palavra (para copiar); fora dele, abre ou fecha os arquivos.
        if (!(e.target as HTMLElement).closest('.commit-subject, .commit-author, .commit-date, .commit-sha')) handlers.current.toggle(commit.sha)
      }}
      onContextMenu={(e) => handlers.current.menu(e, commit)}
      draggable
      onDragStart={(e) => {
        const shas = handlers.current.dragShas(commit)
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
          handlers.current.toggle(commit.sha)
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
                <RefBadges refs={commit.refs} color={row.color} remoteNames={remoteNames} handlers={handlers} />
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
                <Highlight text={formatGridDateTime(commit.date)} query={query} />
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
  )
})

/** Item da lista de alterações do histórico: um arquivo (com o que está no stage e fora dele) ou um conflito. */
type WipItem = ChangeEntry & { conflicted?: boolean }

interface WipProps {
  status: import('../../../shared/types').RepoStatus
  template: string
  columns: readonly Column[]
  graphWidth: number
  searching: boolean
  headRow?: GraphRow
  indent: boolean
  onOpenChanges(): void
  onOpenConflict(path: string): void
  /** Mostra o diff do arquivo no painel de detalhes (clique simples, como nos arquivos de um commit). */
  onOpenFile(path: string): void
  onOpenDiff(source: import('../../../shared/types').DiffSource, path: string, title: string): void
}

/**
 * A primeira linha do histórico é sempre das alterações ainda não commitadas — haja ou não arquivos
 * alterados. Com arquivos, ▸ (ou um clique) abre a lista logo abaixo, como nos commits.
 */
function WipRow({ status, template, columns, graphWidth, searching, headRow, indent, onOpenChanges, onOpenConflict, onOpenFile, onOpenDiff }: WipProps) {
  const [open, setOpen] = useLayout<boolean>('history.wipOpen', (v) => v === true)
  const conflicts: WipItem[] = status.conflicted.map((f: FileStatus) => ({ path: f.path, origPath: f.origPath, unstaged: f, conflicted: true }))
  const items: WipItem[] = [...conflicts, ...buildEntries(status)]
  const files = items.length
  const dirty = files > 0
  const expanded = dirty && open
  const toggle = () => dirty && setOpen(open ? undefined : true)

  const graph = () => {
    const col = searching ? 0 : (headRow?.column ?? 0)
    const color = laneColor(headRow?.color ?? 0)
    const cx = x(col)
    return (
      <svg key="graph" className="graph" width={searching ? x(0) + 8 : graphWidth} height={ROW}>
        {dirty && !searching && <line x1={cx} y1={ROW / 2 + 5} x2={cx} y2={ROW} stroke={color} strokeWidth={2} strokeDasharray="2 3" />}
        <circle cx={cx} cy={ROW / 2} r={4.5} fill="var(--bg)" stroke={dirty ? color : 'var(--text-muted)'} strokeWidth={2} strokeDasharray={dirty ? '3 2' : undefined} />
      </svg>
    )
  }

  const chips = dirty && (
    <span className="wip-chips">
      <span className="wip-chip">{t('common.files', { count: files })}</span>
      {status.conflicted.length > 0 && <span className="wip-chip warn">{t('history.wip.conflicts', { count: status.conflicted.length })}</span>}
      {status.unstaged.length > 0 && <span className="wip-chip">{t('history.wip.unstaged', { count: status.unstaged.length })}</span>}
      {status.staged.length > 0 && <span className="wip-chip ok">{t('history.wip.staged', { count: status.staged.length })}</span>}
    </span>
  )

  const codeOf = (item: WipItem) => (item.conflicted ? 'U' : item.unstaged ? (item.unstaged.untracked ? '?' : item.unstaged.worktree) : item.staged!.index)

  return (
    <>
      <div
        className={`wip-row ${dirty ? 'dirty' : 'clean'} ${expanded ? 'expanded' : ''}`}
        style={{ gridTemplateColumns: template }}
        onClick={toggle}
        title={dirty ? t('history.wip.help') : undefined}
      >
        <button
          className="row-toggle"
          disabled={!dirty}
          aria-expanded={expanded}
          title={expanded ? t('history.menu.hideFiles') : t('history.menu.showFiles')}
          onClick={(e) => {
            e.stopPropagation()
            toggle()
          }}
        >
          {expanded ? '▾' : '▸'}
        </button>
        {columns.map((column, i) => {
          const at = columns.indexOf('subject')
          // As colunas depois da mensagem (autor, data, hash) não têm nada a mostrar aqui: a descrição ocupa o lugar delas.
          if (i > at) return null
          switch (column) {
            case 'graph':
              return graph()
            case 'subject':
              return (
                <div key={column} className="commit-main wip-main" style={{ gridColumn: `span ${columns.length - at}` }}>
                  <span className="wip-title">{dirty ? t('history.wip.title') : `✓ ${t('history.wip.clean')}`}</span>
                  {chips}
                  <button
                    className="wip-open"
                    title={t('history.wip.openHelp')}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenChanges()
                    }}
                  >
                    {t('history.wip.open')} →
                  </button>
                </div>
              )
            case 'author':
              return <span key={column} className="commit-author" />
            case 'date':
              return <span key={column} className="commit-date" />
            case 'sha':
              return <code key={column} className="commit-sha" />
          }
        })}
      </div>
      {expanded && (
        <div className="commit-files wip-files">
          <ul style={{ paddingInlineStart: indent ? GRAPH_OFFSET + graphWidth + 8 : GRAPH_OFFSET }}>
            <FileEntries
              items={items}
              pathOf={(i) => i.path}
              oldPathOf={(i) => i.origPath}
              statusOf={codeOf}
              render={(item, { label, style }) => {
                const code = codeOf(item)
                return (
                  <li
                    key={item.path}
                    className="commit-file"
                    style={style}
                    title={item.conflicted ? t('changes.conflictedHint') : t('history.files.help')}
                    onClick={() => (item.conflicted ? onOpenConflict(item.path) : onOpenFile(item.path))}
                    onDoubleClick={() =>
                      !item.conflicted && onOpenDiff({ kind: item.unstaged ? 'unstaged' : 'staged' }, item.path, `${item.path} · ${t('history.wip.title')}`)
                    }
                  >
                    <span className={`status status-${code}`} title={statusLabel(code)}>
                      {code === '?' ? 'N' : code}
                    </span>
                    {label}
                    <LineStats stats={sumStats(item.staged, item.unstaged)} />
                    {item.staged && !item.unstaged && <span className="wip-chip ok">{t('history.wip.stagedTag')}</span>}
                    {item.staged && item.unstaged && <span className="wip-chip">{t('history.wip.partialTag')}</span>}
                  </li>
                )
              }}
            />
          </ul>
        </div>
      )}
    </>
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
  const { showMenu, openFileView, openInEditor } = useAppActions()
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
      { label: t('history.files.copyPath'), onClick: () => copyText(file.path) }
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
            <Loader size="sm" label={t('loader.files')} />
          </li>
        ) : 'error' in files ? (
          <li className="warning-text">{files.error}</li>
        ) : files.length === 0 ? (
          <li className="muted">{t('history.files.none')}</li>
        ) : (
          <FileEntries
            items={files}
            pathOf={(f) => f.path}
            oldPathOf={(f) => f.oldPath}
            statusOf={(f) => f.status}
            render={(file, { label, style }) => (
              <li
                key={file.path}
                className="commit-file"
                style={style}
                tabIndex={-1}
                data-copy={file.path}
                data-copy-what="path"
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
                {label}
                <LineStats stats={file} />
              </li>
            )}
          />
        )}
      </ul>
    </div>
  )
}

function RefBadges({ refs, color, remoteNames, handlers }: { refs: string[]; color: number; remoteNames: ReadonlySet<string>; handlers: React.RefObject<RowHandlers> }) {
  return (
    <>
      {refs.map((ref) => {
        if (ref === 'HEAD') return <span key={ref} className="ref ref-head">HEAD</span>
        if (ref.startsWith('HEAD -> ')) return <BranchBadge key={ref} name={ref.slice(8)} color={color} remoteNames={remoteNames} handlers={handlers} current />
        if (ref.startsWith('tag: ')) return <span key={ref} className="ref ref-tag">⌂ {ref.slice(5)}</span>
        return <BranchBadge key={ref} name={ref} color={color} remoteNames={remoteNames} handlers={handlers} />
      })}
    </>
  )
}

/**
 * Etiqueta de branch no histórico, na cor da trilha dela: pode ser arrastada, recebe itens soltos e
 * tem o menu da branch no botão direito (o checkout leva para a branch, não para um HEAD destacado).
 * Memorizada: só recebe primitivos, um Set estável e a ref de handlers.
 */
const BranchBadge = memo(function BranchBadge({ name, color, remoteNames, handlers, current = false }: { name: string; color: number; remoteNames: ReadonlySet<string>; handlers: React.RefObject<RowHandlers>; current?: boolean }) {
  const remote = remoteNames.has(name)
  const drop = useDrop(
    (p) => !remote && p.type !== 'files' && !(p.type === 'branch' && p.name === name),
    (p) => handlers.current.dropOnBranch(p, name)
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
      onContextMenu={(e) => handlers.current.branchMenu(e, name)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        handlers.current.checkoutBranch(name)
      }}
      title={`${current ? t('toolbar.currentBranch') : remote ? t('history.badge.remote') : t('history.badge.local')}\n${t('sidebar.branchTooltip')}`}
      {...drop.props}
    >
      {current ? '✓ ' : ''}
      {name}
    </span>
  )
})
