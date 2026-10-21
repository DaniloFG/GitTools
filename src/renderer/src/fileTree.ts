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
  for (const item of items) {
    const path = pathOf(item)
    const parts = path.split('/').filter(Boolean)
    if (parts.length === 0) continue
    let dir = root
    dir.fileCount++
    for (const part of parts.slice(0, -1)) {
      const path = dir.path ? `${dir.path}/${part}` : part
      let next = dir.children.find((c): c is TreeDir<T> => c.kind === 'dir' && c.path === path)
      if (!next) {
        next = { kind: 'dir', name: part, path, children: [], fileCount: 0 }
        dir.children.push(next)
      }
      next.fileCount++
      dir = next
    }
    dir.children.push({ kind: 'file', name: parts[parts.length - 1], path, item })
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
  for (const node of nodes) {
    if (node.kind === 'file') {
      rows.push({ kind: 'file', node, depth })
      continue
    }
    const isCollapsed = collapsed.has(node.path)
    rows.push({ kind: 'dir', node, depth, collapsed: isCollapsed })
    if (!isCollapsed) rows.push(...flattenTree(node.children, collapsed, depth + 1))
  }
  return rows
}
