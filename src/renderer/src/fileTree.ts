// Lista de arquivos em árvore de pastas (como no VS Code). Lógica pura: a tela só desenha as linhas.

/** Como as listas de arquivos aparecem: uma linha por arquivo (nome + pasta) ou agrupadas por pasta. */
export type FileViewMode = 'list' | 'tree'

export const parseFileViewMode = (value: unknown): FileViewMode => (value === 'tree' ? 'tree' : 'list')

export function splitPath(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? { name: path, dir: '' } : { name: path.slice(slash + 1), dir: path.slice(0, slash) }
}

export interface TreeDir<T> {
  kind: 'dir'
  /** Nome mostrado; pastas com um único filho pasta são juntadas ("src/app/ui"). */
  name: string
  /** Caminho completo da pasta (identifica a pasta ao recolher). */
  path: string
  children: TreeNode<T>[]
  /** Arquivos dentro da pasta, em qualquer nível. */
  fileCount: number
}

export interface TreeFile<T> {
  kind: 'file'
  name: string
  path: string
  item: T
}

export type TreeNode<T> = TreeDir<T> | TreeFile<T>

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function buildTree<T>(items: readonly T[], pathOf: (item: T) => string): TreeNode<T>[] {
  const root: TreeDir<T> = { kind: 'dir', name: '', path: '', children: [], fileCount: 0 }
  // Pastas já criadas, pelo caminho completo. Procurar entre os filhos a cada arquivo custava n × filhos;
  // o caminho completo identifica a pasta sem varrer nada. Só pastas entram aqui: arquivo com o mesmo
  // nome de uma pasta continua em `children`, como antes.
  const dirs = new Map<string, TreeDir<T>>()
  for (const item of items) {
    const full = pathOf(item)
    const parts = full.split('/').filter(Boolean)
    if (parts.length === 0) continue
    let dir = root
    dir.fileCount++
    // Itera por índice: `slice` alocaria um array a cada arquivo.
    let path = ''
    for (let i = 0; i < parts.length - 1; i++) {
      path = path ? `${path}/${parts[i]}` : parts[i]
      let next = dirs.get(path)
      if (!next) {
        next = { kind: 'dir', name: parts[i], path, children: [], fileCount: 0 }
        dirs.set(path, next)
        dir.children.push(next)
      }
      next.fileCount++
      dir = next
    }
    dir.children.push({ kind: 'file', name: parts[parts.length - 1], path: full, item })
  }
  return finish(root.children)
}

/** Ordena (pastas primeiro) e junta cadeias de pastas que só têm uma pasta dentro. */
function finish<T>(nodes: TreeNode<T>[]): TreeNode<T>[] {
  const out = nodes.map((node) => {
    if (node.kind === 'file') return node
    let dir = node
    while (dir.children.length === 1 && dir.children[0].kind === 'dir') {
      const only = dir.children[0] as TreeDir<T>
      dir = { ...only, name: `${dir.name}/${only.name}` }
    }
    return { ...dir, children: finish(dir.children) }
  })
  return out.sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'dir' ? -1 : 1))
}

export type TreeRow<T> = { kind: 'dir'; node: TreeDir<T>; depth: number; collapsed: boolean } | { kind: 'file'; node: TreeFile<T>; depth: number }

/** Linhas visíveis da árvore, na ordem da tela; o conteúdo de pastas recolhidas não aparece. */
export function flattenTree<T>(nodes: readonly TreeNode<T>[], collapsed: ReadonlySet<string>, depth = 0): TreeRow<T>[] {
  const rows: TreeRow<T>[] = []
  pushRows(rows, nodes, collapsed, depth)
  return rows
}

/** Empilha as linhas no mesmo array. `rows.push(...filho)` copiava cada subárvore a cada nível e podia estourar a pilha com muitos argumentos. */
function pushRows<T>(rows: TreeRow<T>[], nodes: readonly TreeNode<T>[], collapsed: ReadonlySet<string>, depth: number): void {
  for (const node of nodes) {
    if (node.kind === 'file') {
      rows.push({ kind: 'file', node, depth })
      continue
    }
    const isCollapsed = collapsed.has(node.path)
    rows.push({ kind: 'dir', node, depth, collapsed: isCollapsed })
    if (!isCollapsed) pushRows(rows, node.children, collapsed, depth + 1)
  }
}

/** Primeiro arquivo como a lista o desenha: na ordem da lista, ou na árvore (a primeira linha de arquivo). */
export function firstFileShown(paths: readonly string[], mode: FileViewMode): string | null {
  if (mode === 'list') return paths[0] ?? null
  const first = flattenTree(buildTree(paths, (p) => p), new Set()).find((row) => row.kind === 'file')
  return first?.kind === 'file' ? first.node.path : null
}
