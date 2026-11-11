import { Fragment, memo, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { BranchInfo, StashInfo } from '../../../shared/types'
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
import { useLayout } from '../layout'
import { useFileViewMode } from './FileList'
import { FileViewOptions } from './ViewOptions'
import { buildTree, flattenTree } from '../fileTree'
import { groupBranches } from '../sidebarGroups'
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
  // Agrupado uma vez por lista de branches. As listas mantêm a referência enquanto `data.branches` não muda,
  // e assim as linhas (NameRows) não refazem a árvore a cada desenho.
  const { local, remotes } = useMemo(() => groupBranches(data.branches), [data.branches])

  /** Uma linha por branch; no modo árvore, as com "/" no nome (feature/x) ficam em pastas. */
  const branchRows = (list: BranchInfo[], remote?: string) => (
    <NameRows
      items={list}
      nameOf={(b) => (remote ? b.name.slice(remote.length + 1) : b.name)}
      keyOf={(b) => b.fullRef}
      render={(b, label, indent) => (
        <BranchItem key={b.fullRef} branch={b} label={label} indent={indent} color={colorOf(b)} active={scope.kind === 'ref' && scope.ref === b.name} checked={checkedSet.has(b.name)} handlers={handlers} />
      )}
    />
  )

  const sections: { id: string; node: ReactNode }[] = [
    {
      id: 'branches',
      node: (
        <Section id="branches" title={t('sidebar.branches')} count={local.length} onReorder={move} action={groupAction(local)}>
          {branchRows(local)}
        </Section>
      )
    },
    ...remotes.map(([remote, list]) => ({
      id: `remote.${remote}`,
      node: (
        <Section id={`remote.${remote}`} title={t('sidebar.remote', { remote })} count={list.length} collapsed onReorder={move} action={groupAction(list)}>
          {branchRows(list, remote)}
        </Section>
      )
    }))
  ]
  const ids = sections.map((s) => s.id)
  // Busca por id num Map: procurar com `find` a cada item da ordem repetia a varredura das seções.
  const nodeOf = new Map(sections.map((s) => [s.id, s.node] as const))
  const [order, setOrder] = useLayout('order.sidebar', (value) => parseOrder(value, ids))
  function move(id: string, target: string) {
    setOrder((prev) => moveItem(prev, id, target))
  }

  return (
    <aside className="sidebar">
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
      {order.map((id) => (
        <Fragment key={id}>{nodeOf.get(id)}</Fragment>
      ))}
    </aside>
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
  return (
    <aside className="sidebar">
      <Section id="tags" title={t('sidebar.tags')} count={data.tags.length} action={{ label: '＋', title: t('actions.newTag.title'), run: () => actions.createTag() }} extra={<FileViewOptions title={t('sidebar.viewMode')} />}>
        <NameRows
          items={data.tags}
          nameOf={(tag) => tag.name}
          keyOf={(tag) => tag.name}
          render={(tag, label, indent) => <TagItem key={tag.name} name={tag.name} label={label} indent={indent} sha={tag.sha} handlers={handlers} />}
        />
      </Section>
    </aside>
  )
}

function StashesPanel() {
  const { data } = useRepoData()
  const { run, confirm } = useAppActions()
  const handlers = useRef({} as StashHandlers)
  handlers.current = { run, confirm }
  return (
    <aside className="sidebar">
      <Section id="stashes" title={t('sidebar.stashes')} count={data.stashes.length}>
        {data.stashes.map((s) => (
          <StashItem key={s.ref} stash={s} handlers={handlers} />
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
  /** Outro controle do cabeçalho (ex.: opções de visualização). */
  extra?: ReactNode
}

function Section({ id, title, count, children, collapsed = false, onReorder, action, extra }: SectionProps) {
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
        {extra}
      </div>
      {open && <ul>{children}</ul>}
    </section>
  )
}

/** Recuo (em px) de cada nível da árvore; o mesmo da lista de arquivos. */
const TREE_INDENT = 14

interface NameRowsProps<T> {
  items: readonly T[]
  /** Nome que vai para a árvore (o "/" separa as pastas) e para a linha no modo lista. */
  nameOf(item: T): string
  keyOf(item: T): string
  /** Desenha uma linha; `label` é o nome a mostrar e `indent` o recuo em px (só no modo árvore). Número, não objeto: um objeto novo a cada desenho anularia a memorização dos itens. */
  render(item: T, label: string, indent: number | undefined): ReactNode
}

/**
 * Linhas de branches ou tags no modo escolhido para o app (o mesmo das listas de arquivos): em lista, uma
 * por item; em árvore, agrupadas pelas barras do nome, com pastas recolhíveis.
 */
function NameRows<T>({ items, nameOf, keyOf, render }: NameRowsProps<T>) {
  const [mode] = useFileViewMode()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  // Hooks antes do `if` (regra dos hooks). `nameOf` não entra nas dependências: é função pura e, para uma mesma
  // lista, dá sempre o mesmo nome (o prefixo do remoto vem da própria lista). Por isso as listas passadas
  // precisam ser estáveis: vêm de `useMemo` (BranchesPanel) ou de `data.tags`.
  const tree = useMemo(() => (mode === 'list' ? null : buildTree(items, nameOf)), [items, mode])
  const rows = useMemo(() => (tree ? flattenTree(tree, collapsed) : []), [tree, collapsed])
  if (mode === 'list') {
    return (
      <>
        {items.map((item) => (
          <Fragment key={keyOf(item)}>{render(item, nameOf(item), undefined)}</Fragment>
        ))}
      </>
    )
  }
  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })
  return (
    <>
      {rows.map((row) =>
        row.kind === 'file' ? (
          <Fragment key={keyOf(row.node.item)}>{render(row.node.item, row.node.name, 6 + TREE_INDENT * row.depth + 16)}</Fragment>
        ) : (
          <li
            key={`dir:${row.node.path}`}
            className="tree-dir"
            style={{ paddingInlineStart: 6 + TREE_INDENT * row.depth }}
            onClick={() => toggle(row.node.path)}
            title={`${row.node.path} — ${row.node.fileCount}`}
            aria-expanded={!row.collapsed}
          >
            <span className="tree-caret">{row.collapsed ? '▸' : '▾'}</span>
            <span className="tree-dir-name">{row.node.name}</span>
            <span className="count">{row.node.fileCount}</span>
          </li>
        )
      )}
    </>
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
