// Layout livre das telas (sem React nem DOM, para poder ser testado à parte).
//
// Cada painel (Histórico, Descrição do commit, Não staged, Diff das alterações…) é independente: nenhum é "pai"
// ou "filho" de outro. Os painéis ficam em grupos de abas, e os grupos ficam numa árvore de divisões (lado a
// lado ou um sobre o outro). Qualquer painel pode ser solto em qualquer lado de qualquer outro — ou junto dele,
// como aba — e a árvore se ajusta sozinha.
//
// Cada painel pertence a uma tela (um menu do topo: Histórico, Alterações, Arquivos, Comparar, Branches, Log).
// A tela mostra só os próprios painéis, mais os de outras telas que o usuário fixou nela (`pinned`). A árvore é
// uma só: posições e tamanhos valem para todas as telas, e o que está escondido numa tela continua escondido só nela.

export type ViewId =
  | 'branches'
  | 'tags'
  | 'stashes'
  | 'history'
  | 'commit.message'
  | 'commit.files'
  | 'commit.diff'
  | 'changes.conflicts'
  | 'changes.unstaged'
  | 'changes.staged'
  | 'changes.files'
  | 'changes.commit'
  | 'changes.diff'
  | 'files.list'
  | 'files.history'
  | 'files.diff'
  | 'files.editor'
  | 'files.blame'
  | 'compare.setup'
  | 'compare.files'
  | 'compare.diff'
  | 'gitlog'

export const VIEW_IDS: readonly ViewId[] = [
  'branches',
  'tags',
  'stashes',
  'history',
  'commit.message',
  'commit.files',
  'commit.diff',
  'changes.conflicts',
  'changes.unstaged',
  'changes.staged',
  'changes.files',
  'changes.commit',
  'changes.diff',
  'files.list',
  'files.history',
  'files.diff',
  'files.editor',
  'files.blame',
  'compare.setup',
  'compare.files',
  'compare.diff',
  'gitlog'
]

/** Menus do topo. Cada um mostra os próprios painéis (e os de outras telas que o usuário fixou nele). */
export type ScreenId = 'branches' | 'history' | 'changes' | 'files' | 'compare' | 'gitlog'

/** Painéis de cada tela: a qual menu cada painel pertence. */
export const SCREEN_VIEWS: Record<ScreenId, readonly ViewId[]> = {
  branches: ['branches', 'tags', 'stashes'],
  history: ['history', 'commit.message', 'commit.files', 'commit.diff'],
  changes: ['changes.conflicts', 'changes.unstaged', 'changes.files', 'changes.staged', 'changes.commit', 'changes.diff'],
  files: ['files.list', 'files.history', 'files.diff', 'files.editor', 'files.blame'],
  compare: ['compare.setup', 'compare.files', 'compare.diff'],
  gitlog: ['gitlog']
}

/** Algo que muda quais painéis existem agora. */
export interface Availability {
  /** Visão da tela Alterações: listas separadas ("stage") ou uma lista com caixas de seleção ("check"). */
  changesMode: 'stage' | 'check'
  /** Arquivos em conflito agora. */
  conflicts: number
}

/** O painel existe agora? (Conflitos só com conflitos; Não staged e Staged só na visão de listas separadas.) */
export function viewAvailable(view: ViewId, ctx: Availability): boolean {
  if (view === 'changes.conflicts') return ctx.conflicts > 0
  if (view === 'changes.unstaged' || view === 'changes.staged') return ctx.changesMode === 'stage'
  if (view === 'changes.files') return ctx.changesMode === 'check'
  return true
}

export const SCREEN_IDS = Object.keys(SCREEN_VIEWS) as ScreenId[]

/** Painéis que mostram dados do repositório (todos, menos o log de comandos): escopo padrão do indicador de carregamento. */
export const REPO_VIEWS: readonly ViewId[] = VIEW_IDS.filter((view) => view !== 'gitlog')

/** Tela a que um painel pertence. */
export const screenOf = (view: ViewId): ScreenId => SCREEN_IDS.find((s) => SCREEN_VIEWS[s].includes(view))!

export type Dir = 'row' | 'column'
/** Lado de um painel: "left"/"top" é o começo da linha/coluna (em idiomas da direita para a esquerda, "left" é o lado direito da tela). */
export type Side = 'left' | 'right' | 'top' | 'bottom'

export interface GroupNode {
  kind: 'group'
  id: string
  /** Abas do grupo, na ordem em que aparecem. */
  views: ViewId[]
  /** Aba escolhida (a primeira visível, se ausente ou escondida). */
  active?: ViewId
}

export interface SplitNode {
  kind: 'split'
  id: string
  dir: Dir
  /** Peso de cada filho no espaço da divisão (só a proporção importa). */
  sizes: number[]
  children: DockNode[]
}

export type DockNode = GroupNode | SplitNode

/**
 * Versão do formato guardado. 1: todos os painéis apareciam em todas as telas (layouts antigos, sem `pinned`);
 * 2: cada tela mostra os próprios painéis e os fixados nela. Versões antigas são lidas sem perda (ver `parseDock`).
 */
export const DOCK_VERSION = 2 as const

export interface DockState {
  version: typeof DOCK_VERSION
  root: DockNode
  /** Painéis que o usuário escondeu na tela deles (continuam no lugar deles na árvore, para voltarem para lá). */
  hidden: ViewId[]
  /** Painéis de outras telas fixados em cada tela (ex.: o diff das alterações, dentro do Histórico). */
  pinned: Partial<Record<ScreenId, ViewId[]>>
}

const isView = (v: unknown): v is ViewId => typeof v === 'string' && (VIEW_IDS as readonly string[]).includes(v)
const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

const group = (id: string, views: ViewId[], active?: ViewId): GroupNode => ({ kind: 'group', id, views, ...(active ? { active } : {}) })
const split = (id: string, dir: Dir, sizes: number[], children: DockNode[]): SplitNode => ({ kind: 'split', id, dir, sizes, children })

/**
 * Arranjo de partida: Branches à esquerda; no centro, a lista principal de cada tela (Histórico, Alterações,
 * Arquivos, Comparar) com seus painéis de apoio ao lado e o diff embaixo; o Log do git no rodapé. Cada tela
 * mostra só os seus painéis, então o mesmo arranjo serve a todas (o que não é da tela some e os outros ocupam o espaço).
 */
export function defaultDock(): DockState {
  return {
    version: DOCK_VERSION,
    hidden: [],
    pinned: {},
    root: split('d1', 'row', [0.17, 0.83], [
      split('d0', 'column', [0.64, 0.36], [group('g-branches', ['branches']), group('g-more', ['tags', 'stashes'])]),
      split('d2', 'column', [0.76, 0.24], [
        split('d3', 'row', [0.5, 0.5], [
          split('d4', 'column', [0.3, 0.7], [
            group('g-conflicts', ['changes.conflicts']),
            group('g-main', ['history', 'changes.unstaged', 'changes.files', 'files.list', 'compare.setup'], 'history')
          ]),
          split('d5', 'column', [0.46, 0.54], [
            split('d6', 'row', [0.5, 0.5], [
              group('g-side', ['commit.message', 'changes.staged', 'files.history', 'compare.files'], 'commit.message'),
              group('g-extra', ['commit.files', 'changes.commit'], 'commit.files')
            ]),
            group('g-diff', ['commit.diff', 'changes.diff', 'files.diff', 'files.editor', 'files.blame', 'compare.diff'], 'commit.diff')
          ])
        ]),
        group('g-log', ['gitlog'])
      ])
    ])
  }
}

// ------------------------------------------------------------------------------------ validação

/**
 * Arranjo salvo válido: cada painel aparece exatamente uma vez; painéis que faltam voltam para perto dos da mesma
 * tela. Layouts da versão 1 (sem `version` nem `pinned`) são lidos como estão: a árvore e os escondidos são
 * mantidos e nenhuma tela ganha painéis de outra, até o usuário fixá-los.
 */
export function parseDock(value: unknown): DockState {
  const raw = (value && typeof value === 'object' ? value : {}) as { root?: unknown; hidden?: unknown; pinned?: unknown }
  const seen = new Set<ViewId>()
  const ids = new Set<string>()
  const root = normalize(parseNode(raw.root, seen, ids, 0))
  if (!root) return defaultDock()
  const state: DockState = { version: DOCK_VERSION, root, hidden: [], pinned: {} }
  for (const view of VIEW_IDS) if (!seen.has(view)) placeMissing(state, view)
  const hidden = Array.isArray(raw.hidden) ? raw.hidden.filter((v): v is ViewId => isView(v)) : []
  state.hidden = [...new Set(hidden)]
  state.pinned = parsePinned(raw.pinned)
  return state
}

/** Fixados válidos: só painéis de outra tela (um painel já é da própria tela), sem repetição. */
function parsePinned(value: unknown): DockState['pinned'] {
  const out: DockState['pinned'] = {}
  if (!value || typeof value !== 'object') return out
  for (const screen of SCREEN_IDS) {
    const list = (value as Record<string, unknown>)[screen]
    if (!Array.isArray(list)) continue
    const views = [...new Set(list.filter((v): v is ViewId => isView(v) && screenOf(v) !== screen))]
    if (views.length) out[screen] = views
  }
  return out
}

function uniqueId(wanted: unknown, ids: Set<string>, fallback: string): string {
  let id = typeof wanted === 'string' && wanted && wanted.length < 64 && !ids.has(wanted) ? wanted : fallback
  for (let n = 1; ids.has(id); n++) id = `${fallback}-${n}`
  ids.add(id)
  return id
}

function parseNode(value: unknown, seen: Set<ViewId>, ids: Set<string>, depth: number): DockNode | null {
  if (!value || typeof value !== 'object' || depth > 24) return null
  const raw = value as Record<string, unknown>
  if (raw.kind === 'group') {
    const views = Array.isArray(raw.views) ? raw.views.filter((v): v is ViewId => isView(v) && !seen.has(v) && !!seen.add(v)) : []
    return group(uniqueId(raw.id, ids, `g${ids.size + 1}`), views, isView(raw.active) && views.includes(raw.active) ? raw.active : undefined)
  }
  if (raw.kind === 'split' && Array.isArray(raw.children)) {
    const id = uniqueId(raw.id, ids, `d${ids.size + 1}`)
    const sizes: number[] = []
    const children: DockNode[] = []
    raw.children.forEach((child, i) => {
      const node = parseNode(child, seen, ids, depth + 1)
      if (!node) return
      children.push(node)
      const size = Array.isArray(raw.sizes) ? raw.sizes[i] : undefined
      sizes.push(isPositive(size) ? size : 1)
    })
    return split(id, raw.dir === 'column' ? 'column' : 'row', sizes, children)
  }
  return null
}

/** Tira grupos vazios e divisões sem utilidade (com um só filho, ou do mesmo sentido que a divisão de fora). */
export function normalize(node: DockNode | null): DockNode | null {
  if (!node) return null
  if (node.kind === 'group') {
    if (node.views.length === 0) return null
    const active = node.active && node.views.includes(node.active) ? node.active : undefined
    return { kind: 'group', id: node.id, views: node.views, ...(active ? { active } : {}) }
  }
  const children: DockNode[] = []
  const sizes: number[] = []
  node.children.forEach((child, i) => {
    const next = normalize(child)
    if (!next) return
    const weight = isPositive(node.sizes[i]) ? node.sizes[i] : 1
    if (next.kind === 'split' && next.dir === node.dir) {
      // Divisão do mesmo sentido: seus filhos passam para esta, dividindo o peso que ela tinha.
      const total = next.sizes.reduce((a, b) => a + b, 0)
      next.children.forEach((c, k) => {
        children.push(c)
        sizes.push((next.sizes[k] / total) * weight)
      })
    } else {
      children.push(next)
      sizes.push(weight)
    }
  })
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return { kind: 'split', id: node.id, dir: node.dir, sizes, children }
}

function clone<T extends DockNode>(node: T): T {
  return (node.kind === 'group'
    ? { ...node, views: [...node.views] }
    : { ...node, sizes: [...node.sizes], children: node.children.map(clone) }) as T
}

export function cloneDock(state: DockState): DockState {
  const pinned: DockState['pinned'] = {}
  for (const screen of SCREEN_IDS) if (state.pinned[screen]) pinned[screen] = [...state.pinned[screen]!]
  return { version: DOCK_VERSION, root: clone(state.root), hidden: [...state.hidden], pinned }
}

/** Todos os grupos, na ordem em que aparecem. */
export function groupsOf(node: DockNode): GroupNode[] {
  return node.kind === 'group' ? [node] : node.children.flatMap(groupsOf)
}

export function findGroup(state: DockState, view: ViewId): GroupNode | undefined {
  return groupsOf(state.root).find((g) => g.views.includes(view))
}

function findParent(root: DockNode, target: DockNode): SplitNode | null {
  if (root.kind === 'group') return null
  for (const child of root.children) {
    if (child === target) return root
    const found = findParent(child, target)
    if (found) return found
  }
  return null
}

/** Põe um painel que sumiu do arranjo salvo junto de outro da mesma tela (ou no primeiro grupo). */
function placeMissing(state: DockState, view: ViewId) {
  const groups = groupsOf(state.root)
  const mates = SCREEN_VIEWS[screenOf(view)]
  const home = groups.find((g) => g.views.some((v) => mates.includes(v))) ?? groups[0]
  home.views.push(view)
}

// ------------------------------------------------------------------------------------ mover

/** Onde um painel arrastado seria solto. */
export type DropTarget =
  /** Como aba de um grupo (na posição `index`, ou no fim). */
  | { kind: 'tabs'; group: string; index?: number }
  /** Ao lado de um grupo, dividindo o espaço dele. */
  | { kind: 'split'; group: string; side: Side }
  /** Na borda da janela, ocupando toda a altura/largura. */
  | { kind: 'edge'; side: Side }

const dirOf = (side: Side): Dir => (side === 'left' || side === 'right' ? 'row' : 'column')
const startsLine = (side: Side) => side === 'left' || side === 'top'

/** Fatia do espaço que um painel solto na borda da janela ocupa. */
const EDGE_SHARE = 0.25

/**
 * Move um painel. Dentro do mesmo grupo, `index` se refere à lista antes da mudança (o lugar onde a aba
 * foi solta). O painel movido fica visível; grupos que ficam vazios somem e a árvore se ajusta.
 */
export function moveView(state: DockState, view: ViewId, target: DropTarget): DockState {
  const source = findGroup(state, view)
  if (!source) return state
  const targetGroup = target.kind === 'edge' ? null : target.group
  if (source.views.length === 1 && targetGroup === source.id) return state

  const next = cloneDock(state)
  const from = findGroup(next, view)!
  const oldIndex = from.views.indexOf(view)
  from.views.splice(oldIndex, 1)
  if (from.active === view) delete from.active

  const fresh = group(newId(next, 'g'), [view], view)
  if (target.kind === 'tabs') {
    const to = groupsOf(next.root).find((g) => g.id === target.group)
    if (!to) return state
    let at = target.index ?? to.views.length
    if (to === from && oldIndex < at) at -= 1
    to.views.splice(Math.max(0, Math.min(at, to.views.length)), 0, view)
    to.active = view
  } else if (target.kind === 'split') {
    const to = groupsOf(next.root).find((g) => g.id === target.group)
    if (!to) return state
    const parent = findParent(next.root, to)
    const inOrder = startsLine(target.side) ? [fresh, to] : [to, fresh]
    const wrapper = split(newId(next, 'd'), dirOf(target.side), [1, 1], inOrder)
    if (!parent) next.root = wrapper
    else parent.children[parent.children.indexOf(to)] = wrapper
  } else {
    const dir = dirOf(target.side)
    const root = next.root
    if (root.kind === 'split' && root.dir === dir) {
      const total = root.sizes.reduce((a, b) => a + b, 0)
      const share = (total * EDGE_SHARE) / (1 - EDGE_SHARE)
      if (startsLine(target.side)) {
        root.children.unshift(fresh)
        root.sizes.unshift(share)
      } else {
        root.children.push(fresh)
        root.sizes.push(share)
      }
    } else {
      next.root = split(newId(next, 'd'), dir, startsLine(target.side) ? [EDGE_SHARE, 1 - EDGE_SHARE] : [1 - EDGE_SHARE, EDGE_SHARE], startsLine(target.side) ? [fresh, root] : [root, fresh])
    }
  }
  next.hidden = next.hidden.filter((v) => v !== view)
  next.root = normalize(next.root) ?? defaultDock().root
  return next
}

/** Próximo identificador livre (`g3`, `d7`…): os ids ficam guardados com o arranjo. */
function newId(state: DockState, prefix: 'g' | 'd'): string {
  const used = new Set<string>()
  const walk = (n: DockNode) => {
    used.add(n.id)
    if (n.kind === 'split') n.children.forEach(walk)
  }
  walk(state.root)
  for (let n = 1; ; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`
}

// ------------------------------------------------------------------------------ mostrar e esconder

export const isHidden = (state: DockState, view: ViewId) => state.hidden.includes(view)

/** Esconde um painel (ele continua no lugar dele, para voltar para lá). */
export function hideView(state: DockState, view: ViewId): DockState {
  return state.hidden.includes(view) ? state : { ...state, hidden: [...state.hidden, view] }
}

/** Torna o painel visível e o escolhe como aba do grupo dele. */
export function activateView(state: DockState, view: ViewId): DockState {
  const g = findGroup(state, view)
  if (!g) return state
  // Já está à frente (a escolhida, ou a primeira quando nenhuma foi escolhida): nada a mudar.
  if ((g.active === view || (!g.active && g.views[0] === view)) && !state.hidden.includes(view)) return state
  const next = cloneDock(state)
  findGroup(next, view)!.active = view
  next.hidden = next.hidden.filter((v) => v !== view)
  return next
}

/** Mostra ou esconde um painel. */
export function toggleView(state: DockState, view: ViewId): DockState {
  return state.hidden.includes(view) ? activateView(state, view) : hideView(state, view)
}

// ------------------------------------------------------------------------- o que cada tela mostra

/** Painel visível numa tela: os da própria tela, se não escondidos; os de outra tela, só se fixados nela. */
export function inScreen(state: DockState, view: ViewId, screen: ScreenId): boolean {
  if (screenOf(view) === screen) return !state.hidden.includes(view)
  return !!state.pinned[screen]?.includes(view)
}

/** Painéis de outras telas fixados nesta tela. */
export const pinnedIn = (state: DockState, screen: ScreenId): ViewId[] => state.pinned[screen] ?? []

/**
 * Mostra um painel numa tela: o próprio painel volta (se estava escondido) e fica na aba escolhida do seu grupo;
 * um painel de outra tela passa a ficar fixado nesta, e só nesta.
 */
export function revealIn(state: DockState, view: ViewId, screen: ScreenId): DockState {
  if (screenOf(view) === screen) return activateView(state, view)
  const list = pinnedIn(state, screen)
  const next = list.includes(view) ? state : { ...state, pinned: { ...state.pinned, [screen]: [...list, view] } }
  return activateView(next, view)
}

/** Esconde um painel numa tela: o próprio painel fica escondido; um de outra tela deixa de ficar fixado nesta. */
export function hideIn(state: DockState, view: ViewId, screen: ScreenId): DockState {
  if (screenOf(view) === screen) return hideView(state, view)
  const list = pinnedIn(state, screen)
  if (!list.includes(view)) return state
  const pinned = { ...state.pinned }
  const rest = list.filter((v) => v !== view)
  if (rest.length) pinned[screen] = rest
  else delete pinned[screen]
  return { ...state, pinned }
}

/** Mostra ou esconde um painel numa tela. */
export const toggleIn = (state: DockState, view: ViewId, screen: ScreenId): DockState => (inScreen(state, view, screen) ? hideIn(state, view, screen) : revealIn(state, view, screen))

/**
 * Mostra ou esconde os painéis de uma tela (ex.: a barra de Branches) dentro de `current`, a tela aberta: se algum
 * deles está à vista, esconde todos; senão, traz todos (os de outra tela ficam fixados em `current`).
 */
export function toggleScreenIn(state: DockState, screen: ScreenId, current: ScreenId, available: (view: ViewId) => boolean = () => true): DockState {
  const views = SCREEN_VIEWS[screen].filter(available)
  if (views.some((v) => inScreen(state, v, current))) return views.reduce((s, v) => hideIn(s, v, current), state)
  return views.reduce((s, v) => revealIn(s, v, current), state)
}

/** Traz os painéis (disponíveis) de uma tela, cada um como aba escolhida do seu grupo. Os fixados de outras telas não mudam. */
export function showScreen(state: DockState, screen: ScreenId, available: (view: ViewId) => boolean = () => true): DockState {
  return SCREEN_VIEWS[screen].filter(available).reduce(activateView, state)
}

/** Guarda os pesos de uma divisão (depois de o usuário arrastar a divisória). */
export function setSizes(state: DockState, splitId: string, sizes: number[]): DockState {
  const next = cloneDock(state)
  const find = (n: DockNode): SplitNode | null => {
    if (n.kind === 'group') return null
    if (n.id === splitId) return n
    for (const c of n.children) {
      const found = find(c)
      if (found) return found
    }
    return null
  }
  const target = find(next.root)
  if (!target || sizes.length !== target.children.length || !sizes.every(isPositive)) return state
  target.sizes = sizes
  return next
}

// ------------------------------------------------------------------------------------ o que aparece

/** Aba que aparece no grupo: a escolhida, se visível; senão a primeira visível. */
export function effectiveActive(g: GroupNode, shown: (view: ViewId) => boolean): ViewId | null {
  if (g.active && g.views.includes(g.active) && shown(g.active)) return g.active
  return g.views.find(shown) ?? null
}

export interface ShownGroup {
  kind: 'group'
  id: string
  /** Abas visíveis. */
  views: ViewId[]
  active: ViewId
}
export interface ShownSplit {
  kind: 'split'
  id: string
  dir: Dir
  /** Cada filho com o índice dele na divisão guardada (os escondidos não entram). */
  children: { node: ShownNode; index: number; weight: number }[]
}
export type ShownNode = ShownGroup | ShownSplit

/** A árvore sem o que está escondido ou indisponível: grupos sem abas e divisões vazias somem. */
export function shownTree(state: DockState, shown: (view: ViewId) => boolean): ShownNode | null {
  const walk = (node: DockNode): ShownNode | null => {
    if (node.kind === 'group') {
      const views = node.views.filter(shown)
      const active = effectiveActive(node, shown)
      return active ? { kind: 'group', id: node.id, views, active } : null
    }
    const children = node.children.flatMap((child, index) => {
      const next = walk(child)
      return next ? [{ node: next, index, weight: node.sizes[index] ?? 1 }] : []
    })
    if (children.length === 0) return null
    if (children.length === 1) return children[0].node
    return { kind: 'split', id: node.id, dir: node.dir, children }
  }
  return walk(state.root)
}

// ------------------------------------------------------------------------- redimensionar e soltar

/**
 * Divide o espaço de dois vizinhos ao arrastar a divisória entre eles: `sizeA` e `sizeB` são os tamanhos
 * atuais em pixels, `delta` o quanto a divisória andou; os pesos continuam somando o mesmo.
 */
export function resizePair(weightA: number, weightB: number, sizeA: number, sizeB: number, delta: number, minA: number, minB: number): [number, number] {
  const pair = sizeA + sizeB
  if (pair <= 0) return [weightA, weightB]
  const low = Math.min(minA, pair / 2)
  const high = pair - Math.min(minB, pair / 2)
  const a = Math.min(Math.max(sizeA + delta, low), high)
  const total = weightA + weightB
  return [(a / pair) * total, ((pair - a) / pair) * total]
}

/** Parte central de um painel onde soltar uma aba a junta às do painel (o resto, junto às bordas, divide o painel). */
const CENTER = 0.5

/**
 * Onde, dentro do retângulo, o ponteiro está: no centro (vira aba) ou perto de um lado (divide o painel
 * naquele lado). O lado é o da borda mais próxima, proporcional ao tamanho, para não favorecer o lado maior.
 */
export function zoneAt(x: number, y: number, rect: { left: number; top: number; width: number; height: number }): Side | 'center' {
  const fx = rect.width ? (x - rect.left) / rect.width : 0.5
  const fy = rect.height ? (y - rect.top) / rect.height : 0.5
  const margin = (1 - CENTER) / 2
  if (fx >= margin && fx <= 1 - margin && fy >= margin && fy <= 1 - margin) return 'center'
  const distances: [Side, number][] = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy]
  ]
  return distances.reduce((best, d) => (d[1] < best[1] ? d : best))[0]
}

/** Troca esquerda/direita (para idiomas escritos da direita para a esquerda, em que a linha começa no lado direito). */
export const logicalSide = (side: Side, rtl: boolean): Side => (rtl ? (side === 'left' ? 'right' : side === 'right' ? 'left' : side) : side)
