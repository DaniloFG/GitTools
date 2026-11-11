import { memo, useCallback, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { BranchInfo, StashInfo, TagInfo } from '../../../shared/types'
import { ALL_SCOPE, checkedRefs, toggleGroup, toggleRef, type HistoryScope } from '../historyScope'
import { useActions } from '../actions'
import { useBranchMenu } from '../branchMenu'
import { useAppActions, useRepoData, type AppActions } from '../context'
import { endDrag, startDrag, type DragPayload } from '../dnd'
import { git } from '../git'
import { readScreen } from '../dockStore'
import { relativeDate } from '../format'
import { commitColors, laneColor } from '../graph'
import { useDrop } from '../useDrop'
import { readLayout, subscribeLayout, useLayout, writeLayout } from '../layout'
import { useFileViewMode } from './FileList'
import { FileViewOptions } from './ViewOptions'
import { groupBranches } from '../sidebarGroups'
import { buildNameTree, listNameRows, treeNameRows, type NameRow } from '../sidebarRows'
import { moveItem, parseOrder, startReorder } from '../reorder'
import { t } from '../i18n'
import { PaneSlot } from '../slots'
import { VirtualList } from './VirtualList'

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
 * Altura fixa das linhas de branch e de tag: a CSS `.sidebar .branch-item:not(.current)` tem esta mesma altura,
 * e a VirtualList não precisa medir essas linhas. As outras (seção, pasta, branch atual, stash) têm altura
 * diferente e são medidas.
 */
const ROW_HEIGHT = 27

/**
 * Uma linha da barra lateral, já achatada. Cabeçalho de seção e pasta são linhas como as demais: a lista inteira
 * é uma só, e só as linhas perto da tela são montadas.
 */
type Row =
  | { kind: 'section'; key: string; id: string; count: number; open: boolean }
  | { kind: 'branch'; key: string; branch: BranchInfo; label: string; indent: number | undefined }
  | { kind: 'tag'; key: string; tag: TagInfo; label: string; indent: number | undefined }
  | { kind: 'dir'; key: string; sectionId: string; path: string; name: string; fileCount: number; indent: number; collapsed: boolean }
  | { kind: 'stash'; key: string; stash: StashInfo }

type DirRow = Extract<Row, { kind: 'dir' }>

/** Pastas recolhidas de cada seção (pelo caminho completo). Cada seção tem a sua: o mesmo caminho pode existir em duas. */
type CollapsedDirs = ReadonlyMap<string, ReadonlySet<string>>
const NO_DIRS: ReadonlySet<string> = new Set()

/** Uma seção do painel de branches: as locais (remote nulo) ou as de um remoto. Os ids são os de antes. */
interface BranchSection {
  id: string
  list: BranchInfo[]
  remote: string | null
}

/** Nome mostrado da branch: no remoto, sem o prefixo "origin/" (a seção já diz de qual remoto é). */
const branchLabel = (b: BranchInfo, remote: string | null) => (remote ? b.name.slice(remote.length + 1) : b.name)

/** Chave do layout que guarda se uma seção está aberta (a mesma de antes, para não perder o que já foi escolhido). */
const sectionKey = (id: string) => `sidebar.${id}.open`

/** Aberta ou fechada, como está no layout; sem valor guardado, vale o padrão da seção. */
function sectionOpen(id: string, defaultOpen: boolean): boolean {
  const value = readLayout(sectionKey(id))
  return typeof value === 'boolean' ? value : defaultOpen
}

/** Linhas com altura medida: pasta, seção e stash, e a branch atual (tem borda e margem). Tag e branch comum são fixas. */
const isVariableRow = (row: Row) => (row.kind === 'branch' ? row.branch.current : row.kind !== 'tag')

/**
 * Passa as linhas de um nome (branch ou tag) para a lista achatada. `toItem` monta a linha do item do tipo certo;
 * pastas viram linhas `dir`. Empurra num array só (sem `push(...lista)`, que estoura com listas grandes).
 */
function pushRows<T>(out: Row[], nodes: readonly NameRow<T>[], sectionId: string, toItem: (item: T, label: string, indent: number | undefined) => Row) {
  for (const node of nodes) {
    if (node.kind === 'item') out.push(toItem(node.item, node.label, node.indent))
    else out.push({ kind: 'dir', key: `dir:${sectionId}:${node.path}`, sectionId, path: node.path, name: node.name, fileCount: node.fileCount, indent: node.indent, collapsed: node.collapsed })
  }
}

/**
 * Lista em janela de um painel. Só as linhas perto da área visível são montadas; as outras são um espaço com a
 * altura exata, então a barra de rolagem continua fiel ao tamanho da lista.
 */
function SidebarList({ rows, renderRow, header }: { rows: readonly Row[]; renderRow(row: Row): ReactNode; header?: ReactNode }) {
  // Identidades estáveis enquanto as linhas não mudam: a VirtualList só refaz as posições quando elas mudam.
  const keyOf = useCallback((i: number) => rows[i].key, [rows])
  const isVariable = useCallback((i: number) => isVariableRow(rows[i]), [rows])
  return (
    <VirtualList
      className="sidebar"
      role="complementary"
      count={rows.length}
      rowHeight={ROW_HEIGHT}
      keyOf={keyOf}
      isVariable={isVariable}
      header={header}
      renderItem={(i) => renderRow(rows[i])}
    />
  )
}

/** Cor de cada branch: a da sua trilha no grafo do histórico completo. A lista de branches é a referência e não
 * muda ao marcar branches (só o histórico e as linhas do tempo mudam): enquanto o histórico está filtrado, as
 * cores continuam as da última vez em que ele mostrava tudo. */
function useBranchColors(scope: HistoryScope): (b: BranchInfo) => number | undefined {
  const { data, repo } = useRepoData()
  const full = useRef<{ root: string; colors: Map<string, number> }>({ root: repo.root, colors: new Map() })
  if (full.current.root !== repo.root) full.current = { root: repo.root, colors: new Map() }
  // Mapa de ~500 commits: refeito só quando o histórico ou o HEAD mudam, não a cada desenho.
  const current = useMemo(() => commitColors(data.log, data.status.headSha), [data.log, data.status.headSha])
  if (scope.kind === 'all') for (const b of data.branches) if (current.has(b.sha)) full.current.colors.set(b.name, current.get(b.sha)!)
  return (b) => full.current.colors.get(b.name) ?? (scope.kind === 'all' ? current.get(b.sha) : undefined)
}

function BranchesPanel({ scope, onScope }: Props) {
  const { data } = useRepoData()
  const { showMenu } = useAppActions()
  const actions = useActions()
  const branchMenu = useBranchMenu(onScope)
  const colorOf = useBranchColors(scope)
  const checked = checkedRefs(scope)
  // `includes` por linha era quadrático com muitas branches marcadas: um conjunto dá a consulta em tempo constante.
  const checkedSet = useMemo(() => new Set(checked), [scope])
  const toggle = (name: string) => onScope(toggleRef(scope, name), { reveal: false })
  // Funções de sempre-atuais para as linhas, que são memorizadas: reatribuídas a cada desenho e lidas só nos eventos.
  const handlers = useRef({} as BranchHandlers)
  handlers.current = {
    toggle,
    onScope,
    menu: (e, branch) => showMenu(e, branchMenu(branch)),
    dropOnBranch: (payload, name) => actions.dropOnBranch(payload, name),
    checkout: (name) => actions.checkout(name)
  }
  const groupAction = (list: BranchInfo[]) => ({
    label: '☑',
    title: t('sidebar.toggleGroup'),
    run: () => onScope(toggleGroup(scope, list.map((b) => b.name)), { reveal: false })
  })
  const [mode] = useFileViewMode()
  // Uma seção por grupo: as locais e uma por remoto. Agrupado uma vez por lista de branches (ver sidebarGroups).
  const sections = useMemo<BranchSection[]>(() => {
    const { local, remotes } = groupBranches(data.branches)
    return [{ id: 'branches', list: local, remote: null }, ...remotes.map(([remote, list]) => ({ id: `remote.${remote}`, list, remote }))]
  }, [data.branches])
  const ids = useMemo(() => sections.map((s) => s.id), [sections])
  const [order, setOrder] = useLayout('order.sidebar', (value) => parseOrder(value, ids))
  function move(id: string, target: string) {
    setOrder((prev) => moveItem(prev, id, target))
  }
  // Aberta ou fechada de cada seção, num texto com um caractere por seção: o React compara por valor e só
  // redesenha o painel quando alguma seção muda. A remota começa fechada; a local, aberta.
  const openFlags = useSyncExternalStore(subscribeLayout, () => sections.map((s) => (sectionOpen(s.id, s.remote === null) ? '1' : '0')).join(''))
  const [collapsed, setCollapsed] = useState<CollapsedDirs>(() => new Map())
  // Árvore de cada seção, só no modo árvore. Refeita quando a lista de branches muda, não a cada clique numa pasta.
  const trees = useMemo(
    () => (mode === 'tree' ? new Map(sections.map((s) => [s.id, buildNameTree(s.list, (b) => branchLabel(b, s.remote))] as const)) : null),
    [sections, mode]
  )
  const rows = useMemo(() => {
    const byId = new Map(sections.map((s, i) => [s.id, { section: s, open: openFlags[i] === '1' }] as const))
    const out: Row[] = []
    for (const id of order) {
      const entry = byId.get(id)
      if (!entry) continue
      const { section, open } = entry
      out.push({ kind: 'section', key: `section:${id}`, id, count: section.list.length, open })
      if (!open) continue
      const branchRow = (b: BranchInfo, label: string, indent: number | undefined): Row => ({ kind: 'branch', key: b.fullRef, branch: b, label, indent })
      const tree = trees?.get(id)
      if (tree) pushRows(out, treeNameRows(tree, collapsed.get(id) ?? NO_DIRS), id, branchRow)
      else pushRows(out, listNameRows(section.list, (b) => branchLabel(b, section.remote)), id, branchRow)
    }
    return out
  }, [order, sections, openFlags, trees, collapsed])

  const toggleDir = (sectionId: string, path: string) =>
    setCollapsed((prev) => {
      const next = new Map(prev)
      const dirs = new Set<string>(prev.get(sectionId) ?? NO_DIRS)
      if (!dirs.delete(path)) dirs.add(path)
      next.set(sectionId, dirs)
      return next
    })

  const renderRow = (row: Row): ReactNode => {
    switch (row.kind) {
      case 'section': {
        const section = sections.find((s) => s.id === row.id)
        if (!section) return null
        const title = section.remote === null ? t('sidebar.branches') : t('sidebar.remote', { remote: section.remote })
        return (
          <SectionRow
            id={row.id}
            title={title}
            count={row.count}
            open={row.open}
            onReorder={move}
            onToggle={() => writeLayout(sectionKey(row.id), !row.open)}
            action={groupAction(section.list)}
          />
        )
      }
      case 'branch':
        return (
          <BranchItem
            branch={row.branch}
            label={row.label}
            indent={row.indent}
            color={colorOf(row.branch)}
            active={scope.kind === 'ref' && scope.ref === row.branch.name}
            checked={checkedSet.has(row.branch.name)}
            handlers={handlers}
          />
        )
      case 'dir':
        return <TreeDir row={row} onToggle={() => toggleDir(row.sectionId, row.path)} />
      default:
        return null
    }
  }

  return (
    <SidebarList
      rows={rows}
      renderRow={renderRow}
      header={
        <>
          <div className="sidebar-head">
            <p className="sidebar-hint">{t('sidebar.hint')}</p>
            <FileViewOptions title={t('sidebar.viewMode')} />
          </div>
          {/* Sempre presente, com a mesma altura: marcar branches não desloca a lista abaixo. */}
          <div className={`sidebar-filter ${checked.length > 0 ? 'active' : ''}`} role="status">
            <span title={checked.length > 0 ? t('sidebar.filterActive', { count: checked.length }) : t('sidebar.filterNone')}>
              {checked.length > 0 ? t('sidebar.filterActive', { count: checked.length }) : t('sidebar.filterNone')}
            </span>
            <button className="link" style={{ visibility: checked.length > 0 ? 'visible' : 'hidden' }} tabIndex={checked.length > 0 ? 0 : -1} onClick={() => onScope(ALL_SCOPE, { reveal: false })}>
              {t('sidebar.filterClear')}
            </button>
          </div>
        </>
      }
    />
  )
}

function TagsPanel() {
  const { data } = useRepoData()
  const { selectCommit, showMenu } = useAppActions()
  const actions = useActions()
  const handlers = useRef({} as TagHandlers)
  handlers.current = {
    selectCommit,
    menu: (e, name) =>
      showMenu(e, [
        { label: t('sidebar.menu.checkoutDetached'), onClick: () => actions.checkout(name) },
        { label: t('sidebar.menu.newBranchFromTag'), onClick: () => actions.createBranch(name) },
        'separator',
        { label: t('sidebar.menu.deleteTag'), onClick: () => actions.deleteTag(name) }
      ])
  }
  const [mode] = useFileViewMode()
  const [open, setOpen] = useLayout('sidebar.tags.open', (value) => (typeof value === 'boolean' ? value : true))
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const tree = useMemo(() => (mode === 'tree' ? buildNameTree(data.tags, (tag) => tag.name) : null), [data.tags, mode])
  const rows = useMemo(() => {
    const out: Row[] = [{ kind: 'section', key: 'section:tags', id: 'tags', count: data.tags.length, open }]
    if (open) pushRows(out, tree ? treeNameRows(tree, collapsed) : listNameRows(data.tags, (tag) => tag.name), 'tags', (tag, label, indent) => ({ kind: 'tag', key: tag.name, tag, label, indent }))
    return out
  }, [data.tags, open, tree, collapsed])

  const toggleDir = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const renderRow = (row: Row): ReactNode => {
    switch (row.kind) {
      case 'section':
        return (
          <SectionRow
            id="tags"
            title={t('sidebar.tags')}
            count={row.count}
            open={row.open}
            onToggle={() => setOpen(!row.open)}
            action={{ label: '＋', title: t('actions.newTag.title'), run: () => actions.createTag() }}
            extra={<FileViewOptions title={t('sidebar.viewMode')} />}
          />
        )
      case 'tag':
        return <TagItem name={row.tag.name} label={row.label} indent={row.indent} sha={row.tag.sha} handlers={handlers} />
      case 'dir':
        return <TreeDir row={row} onToggle={() => toggleDir(row.path)} />
      default:
        return null
    }
  }

  return <SidebarList rows={rows} renderRow={renderRow} />
}

function StashesPanel() {
  const { data } = useRepoData()
  const { run, confirm } = useAppActions()
  const handlers = useRef({} as StashHandlers)
  handlers.current = { run, confirm }
  const [open, setOpen] = useLayout('sidebar.stashes.open', (value) => (typeof value === 'boolean' ? value : true))
  const rows = useMemo(() => {
    const out: Row[] = [{ kind: 'section', key: 'section:stashes', id: 'stashes', count: data.stashes.length, open }]
    if (open) for (const stash of data.stashes) out.push({ kind: 'stash', key: stash.ref, stash })
    return out
  }, [data.stashes, open])

  const renderRow = (row: Row): ReactNode => {
    switch (row.kind) {
      case 'section':
        return <SectionRow id="stashes" title={t('sidebar.stashes')} count={row.count} open={row.open} onToggle={() => setOpen(!row.open)} />
      case 'stash':
        return <StashItem stash={row.stash} handlers={handlers} />
      default:
        return null
    }
  }

  return <SidebarList rows={rows} renderRow={renderRow} />
}

interface SectionRowProps {
  /** Id da seção (o que a ordem e o estado aberto guardam). */
  id: string
  title: string
  count: number
  open: boolean
  onToggle(): void
  /** Arrastar o cabeçalho sobre outra seção troca a ordem delas (só nos painéis com mais de uma seção). */
  onReorder?(id: string, target: string): void
  /** Botão no cabeçalho (ex.: criar tag, marcar o grupo). */
  action?: { label: string; title: string; run(): void }
  /** Outro controle do cabeçalho (ex.: opções de visualização). */
  extra?: ReactNode
}

/** Cabeçalho de uma seção. As linhas dela vêm depois, na mesma lista (a seção fechada não tem linhas). */
function SectionRow({ id, title, count, open, onToggle, onReorder, action, extra }: SectionRowProps) {
  return (
    <section className="sidebar-section" data-reorder={onReorder ? 'sidebar' : undefined} data-reorder-id={onReorder ? id : undefined}>
      <div className="section-header-row">
        <button
          className="section-header"
          title={onReorder ? t('layout.reorderHelp') : undefined}
          onClick={onToggle}
          onPointerDown={onReorder ? (e) => startReorder(e, 'sidebar', id, onReorder) : undefined}
        >
          <span>{open ? '▾' : '▸'}</span> {title} <span className="count">{count}</span>
        </button>
        {action && (
          <button className="section-action" title={action.title} onClick={action.run}>
            {action.label}
          </button>
        )}
        {extra}
      </div>
    </section>
  )
}

/** Pasta da árvore de branches ou de tags: clicar recolhe ou abre o que está dentro dela. */
function TreeDir({ row, onToggle }: { row: DirRow; onToggle(): void }) {
  return (
    <li className="tree-dir" style={{ paddingInlineStart: row.indent }} onClick={onToggle} title={`${row.path} — ${row.fileCount}`} aria-expanded={!row.collapsed}>
      <span className="tree-caret">{row.collapsed ? '▸' : '▾'}</span>
      <span className="tree-dir-name">{row.name}</span>
      <span className="count">{row.fileCount}</span>
    </li>
  )
}

/** Ações das linhas de branch. A ref é reatribuída a cada desenho do painel e lida só dentro dos eventos. */
interface BranchHandlers {
  toggle(name: string): void
  onScope: Props['onScope']
  menu(e: React.MouseEvent, branch: BranchInfo): void
  dropOnBranch(payload: DragPayload, name: string): void
  checkout(name: string): void
}

interface BranchItemProps {
  branch: BranchInfo
  /** Nome mostrado (sem o remoto; no modo árvore, só o último pedaço). */
  label: string
  /** Recuo na árvore, em px (ausente no modo lista). */
  indent?: number
  /** Cor da trilha da branch no grafo (ausente quando o commit não está no histórico carregado). */
  color: number | undefined
  active: boolean
  /** Marcada na caixa de seleção: o histórico lista só as branches marcadas. */
  checked: boolean
  handlers: React.RefObject<BranchHandlers>
}

/** Texto da dica da branch (usado só ao passar o mouse). */
function branchTooltip(branch: BranchInfo): string {
  return `${branch.name}${branch.current ? ` (${t('toolbar.currentBranch')})` : ''}\n${branch.subject}\n${relativeDate(branch.date)}\n\n${t('sidebar.branchTooltip')}`
}

/** Memorizada: a lista de branches redesenha só as linhas cujas propriedades mudaram (não as 1.100). */
const BranchItem = memo(function BranchItem({ branch, label, indent, color, active, checked, handlers }: BranchItemProps) {
  const isRemote = !!branch.remote
  const drop = useDrop(
    (p) => !isRemote && !(p.type === 'branch' && p.name === branch.name) && p.type !== 'files',
    (p) => handlers.current.dropOnBranch(p, branch.name)
  )

  return (
    <li
      className={`branch-item ${branch.current ? 'current' : ''} ${active ? 'active' : ''} ${drop.over ? 'drop-over' : ''}`}
      tabIndex={-1}
      data-copy={branch.name}
      data-copy-what="text"
      draggable
      onDragStart={(e) => startDrag(e, { type: 'branch', name: branch.name, remote: isRemote }, `⎇ ${branch.name}`)}
      onDragEnd={endDrag}
      onClick={() => handlers.current.onScope({ kind: 'ref', ref: branch.name })}
      onDoubleClick={() => !branch.current && handlers.current.checkout(branch.name)}
      onContextMenu={(e) => handlers.current.menu(e, branch)}
      // A dica é montada ao passar o mouse, não a cada desenho (data formatada por linha custava caro).
      // `drop.props` não define onMouseEnter (ver useDrop.ts), então não há conflito com o espalhamento abaixo.
      onMouseEnter={(e) => {
        e.currentTarget.title = branchTooltip(branch)
      }}
      style={{ ...(color === undefined ? {} : { '--branch-color': laneColor(color) }), ...(indent === undefined ? {} : { paddingInlineStart: indent }) } as CSSProperties}
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
        onChange={() => handlers.current.toggle(branch.name)}
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
})

/** Ações das linhas de tag (ver BranchHandlers). */
interface TagHandlers {
  selectCommit(sha: string): void
  menu(e: React.MouseEvent, name: string): void
}

/** Memorizada, como BranchItem: só recebe primitivos e a ref. */
const TagItem = memo(function TagItem({ name, label, indent, sha, handlers }: { name: string; label: string; indent?: number; sha: string; handlers: React.RefObject<TagHandlers> }) {
  return (
    <li
      className="branch-item"
      style={indent === undefined ? undefined : { paddingInlineStart: indent }}
      // Na tela de branches o clique não troca para o histórico.
      onClick={() => readScreen() !== 'branches' && handlers.current.selectCommit(sha)}
      onContextMenu={(e) => handlers.current.menu(e, name)}
    >
      <span className="branch-icon">⌂</span>
      <span className="branch-name">{label}</span>
    </li>
  )
})

/** Ações das linhas de stash (ver BranchHandlers). */
interface StashHandlers {
  run: AppActions['run']
  confirm: AppActions['confirm']
}

/** Memorizada, como BranchItem. */
const StashItem = memo(function StashItem({ stash, handlers }: { stash: StashInfo; handlers: React.RefObject<StashHandlers> }) {
  const drop = async () => {
    const { run, confirm } = handlers.current
    const ok = await confirm({
      title: t('sidebar.stash.dropTitle'),
      message: t('sidebar.stash.dropMessage', { message: stash.message }),
      confirmLabel: t('common.discard'),
      danger: true
    })
    if (ok) await run(t('busy.droppingStash'), () => git.stashDrop(stash.index))
  }
  return (
    // Dica montada ao passar o mouse, como nas branches.
    <li
      className="stash-item"
      onMouseEnter={(e) => {
        e.currentTarget.title = `${stash.ref} · ${relativeDate(stash.date)}`
      }}
    >
      <span className="branch-name">{stash.message}</span>
      <span className="stash-actions">
        <button onClick={() => handlers.current.run(t('busy.applyingStash'), () => git.stashApply(stash.index, true))} title={t('sidebar.stash.pop')}>
          ⤓
        </button>
        <button onClick={() => handlers.current.run(t('busy.applyingStash'), () => git.stashApply(stash.index))} title={t('sidebar.stash.apply')}>
          ⧉
        </button>
        <button onClick={drop} title={t('common.discard')}>
          ✕
        </button>
      </span>
    </li>
  )
})
