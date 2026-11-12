import { describe, expect, it } from 'vitest'
import { buildTree, diffPathParts, flattenTree, parseFileViewMode, splitPath } from '../src/renderer/src/fileTree'
import type { TreeDir, TreeNode, TreeRow } from '../src/renderer/src/fileTree'

const files = ['README.md', 'src/app/ui/a.tsx', 'src/app/ui/b.tsx', 'src/core/x.ts', 'src/main.ts', 'docs/guide/setup/one.md']
const tree = buildTree(files, (f) => f)

describe('fileTree', () => {
  it('separa nome e pasta', () => {
    expect(splitPath('src/app/a.ts')).toEqual({ name: 'a.ts', dir: 'src/app' })
    expect(splitPath('a.ts')).toEqual({ name: 'a.ts', dir: '' })
  })

  it('agrupa por pasta, pastas primeiro e juntando cadeias de pasta única', () => {
    expect(tree.map((n) => `${n.kind}:${n.name}`)).toEqual(['dir:docs/guide/setup', 'dir:src', 'file:README.md'])
    const src = tree[1]
    expect(src.kind === 'dir' && src.children.map((n) => `${n.kind}:${n.name}`)).toEqual(['dir:app/ui', 'dir:core', 'file:main.ts'])
    expect(src.kind === 'dir' && src.fileCount).toBe(4)
  })

  it('lista só o que está visível e respeita pastas recolhidas', () => {
    const all = flattenTree(tree, new Set())
    expect(all.map((r) => r.node.name)).toEqual(['docs/guide/setup', 'one.md', 'src', 'app/ui', 'a.tsx', 'b.tsx', 'core', 'x.ts', 'main.ts', 'README.md'])
    expect(all.filter((r) => r.kind === 'file').map((r) => r.depth)).toEqual([1, 2, 2, 2, 1, 0])
    const collapsed = flattenTree(tree, new Set(['src/app/ui', 'docs/guide/setup']))
    expect(collapsed.map((r) => r.node.name)).toEqual(['docs/guide/setup', 'src', 'app/ui', 'core', 'x.ts', 'main.ts', 'README.md'])
  })

  it('guarda o item original de cada arquivo', () => {
    const items = [{ path: 'a/b.ts', n: 1 }]
    const [dir] = buildTree(items, (i) => i.path)
    expect(dir.kind === 'dir' && dir.children[0].kind === 'file' && dir.children[0].item).toBe(items[0])
  })

  it('uma lista grande (5 000 arquivos) entra inteira na árvore, sem perder nenhum', () => {
    const many = Array.from({ length: 5000 }, (_, i) => `pasta-${i % 40}/sub-${Math.floor(i / 40) % 25}/arquivo-${i}.ts`)
    const big = buildTree(many, (f) => f)
    const rows = flattenTree(big, new Set())
    expect(big.reduce((n, node) => n + (node.kind === 'dir' ? node.fileCount : 1), 0)).toBe(5000)
    expect(rows.filter((r) => r.kind === 'file').length).toBe(5000)
  })

  it('valida o modo guardado', () => {
    expect(parseFileViewMode('tree')).toBe('tree')
    expect(parseFileViewMode('x')).toBe('list')
    expect(parseFileViewMode(undefined)).toBe('list')
  })
})

describe('stepIndex (navegação entre alterações)', () => {
  it('anda em círculo e começa do primeiro/último', async () => {
    const { stepIndex } = await import('../src/renderer/src/cycle')
    expect(stepIndex(-1, 1, 3)).toBe(0)
    expect(stepIndex(-1, -1, 3)).toBe(2)
    expect(stepIndex(2, 1, 3)).toBe(0)
    expect(stepIndex(0, -1, 3)).toBe(2)
    expect(stepIndex(1, 1, 3)).toBe(2)
    expect(stepIndex(0, 1, 0)).toBe(-1)
  })
})

// Referência: a implementação anterior de buildTree/flattenTree, copiada aqui para provar que a versão linear
// dá exatamente o mesmo resultado. Não usar em código de produção.
const refCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function refBuildTree<T>(items: readonly T[], pathOf: (item: T) => string): TreeNode<T>[] {
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
  return refFinish(root.children)
}

function refFinish<T>(nodes: TreeNode<T>[]): TreeNode<T>[] {
  const out = nodes.map((node) => {
    if (node.kind === 'file') return node
    let dir = node
    while (dir.children.length === 1 && dir.children[0].kind === 'dir') {
      const only = dir.children[0] as TreeDir<T>
      dir = { ...only, name: `${dir.name}/${only.name}` }
    }
    return { ...dir, children: refFinish(dir.children) }
  })
  return out.sort((a, b) => (a.kind === b.kind ? refCollator.compare(a.name, b.name) : a.kind === 'dir' ? -1 : 1))
}

function refFlattenTree<T>(nodes: readonly TreeNode<T>[], collapsed: ReadonlySet<string>, depth = 0): TreeRow<T>[] {
  const rows: TreeRow<T>[] = []
  for (const node of nodes) {
    if (node.kind === 'file') {
      rows.push({ kind: 'file', node, depth })
      continue
    }
    const isCollapsed = collapsed.has(node.path)
    rows.push({ kind: 'dir', node, depth, collapsed: isCollapsed })
    if (!isCollapsed) rows.push(...refFlattenTree(node.children, collapsed, depth + 1))
  }
  return rows
}

function collectDirPaths<T>(nodes: TreeNode<T>[], out: string[] = []): string[] {
  for (const node of nodes) if (node.kind === 'dir') {
    out.push(node.path)
    collectDirPaths(node.children, out)
  }
  return out
}

describe('buildTree e flattenTree são iguais à implementação anterior', () => {
  const pathOf = (p: string) => p

  it('casos de borda: barras repetidas, barra no início e no fim, caminho vazio, arquivo e pasta com o mesmo nome, ordem de inserção', () => {
    const paths = [
      'a', 'a/b', 'a/b/c.ts', 'x.ts', 'x.ts/y', // "a" arquivo e "a" pasta no mesmo nível
      '/lead/file.ts', 'trail/dir/', 'rep//eated///f.ts', '', '/', '//', // descartados ou normalizados
      'src/app/ui/a.tsx', 'src/app/ui/b.tsx', 'src/app/z.ts', 'src/app/ui/a.tsx', // duplicado
      'src/Core/a.ts', 'src/core/b.ts', // empate no collator (sensitivity base)
      'pasta/file10.ts', 'pasta/file2.ts', 'pasta/file1.ts', 'Pasta/x.ts', // ordem numérica
      'chain/one/two/three/leaf.ts', 'chain/one/other.ts', // cadeia de pastas de filho único
    ]
    expect(buildTree(paths, pathOf)).toEqual(refBuildTree(paths, pathOf))
    expect(buildTree([], pathOf)).toEqual(refBuildTree([], pathOf))
    expect(buildTree(['', '/'], pathOf)).toEqual(refBuildTree(['', '/'], pathOf))

    const next = buildTree(paths, pathOf)
    const ref = refBuildTree(paths, pathOf)
    const dirs = collectDirPaths(ref)
    for (const set of [new Set<string>(), new Set(dirs), new Set(dirs.filter((_, i) => i % 2 === 0))]) {
      for (const depth of [0, 2]) expect(flattenTree(next, set, depth)).toEqual(refFlattenTree(ref, set, depth))
    }
  })

  it('3 000 caminhos gerados de forma determinística, em várias profundidades, com pastas recolhidas', () => {
    let seed = 7
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
      return seed % n
    }
    const names = ['src', 'app', 'ui', 'core', 'Docs', 'docs', 'file10', 'file2', 'a', 'b']
    const paths = Array.from({ length: 3000 }, (_, i) => {
      const segs = Array.from({ length: 1 + rnd(6) }, () => names[rnd(names.length)])
      segs.push(`arq-${i}.ts`)
      const joined = segs.join('/')
      return rnd(25) === 0 ? `/${joined}//` : joined
    })

    const next = buildTree(paths, pathOf)
    const ref = refBuildTree(paths, pathOf)
    expect(next).toEqual(ref)

    const dirs = collectDirPaths(ref)
    expect(dirs.length).toBeGreaterThan(50)
    const sets = [new Set<string>(), new Set(dirs), new Set(dirs.filter((_, i) => i % 3 === 0))]
    for (const set of sets) {
      for (const depth of [0, 2]) expect(flattenTree(next, set, depth)).toEqual(refFlattenTree(ref, set, depth))
    }
  })

  // Cabeçalho do diff (#160): o diretório encolhe com reticências e o nome do arquivo fica inteiro enquanto couber.
  describe('diffPathParts', () => {
    it('separa o diretório (com a barra final) do nome do arquivo', () => {
      expect(diffPathParts('pacotes/interface/componentes/painel.ts')).toEqual({
        prefix: 'pacotes/interface/componentes/',
        name: 'painel.ts',
        title: 'pacotes/interface/componentes/painel.ts'
      })
    })

    it('sem pasta: nenhum prefixo, o nome é o caminho inteiro', () => {
      expect(diffPathParts('README.md')).toEqual({ prefix: '', name: 'README.md', title: 'README.md' })
    })

    it('nome com ponto e pasta com ponto: o corte é na última barra', () => {
      expect(diffPathParts('v1.2/src/.config/a.b.ts')).toEqual({ prefix: 'v1.2/src/.config/', name: 'a.b.ts', title: 'v1.2/src/.config/a.b.ts' })
      expect(diffPathParts('.env')).toEqual({ prefix: '', name: '.env', title: '.env' })
    })

    it('renomeação: o caminho antigo entra antes do diretório, e o título leva "antigo → novo"', () => {
      expect(diffPathParts('novo/dir/arq.ts', 'antigo/arq.ts')).toEqual({
        prefix: 'antigo/arq.ts → novo/dir/',
        name: 'arq.ts',
        title: 'antigo/arq.ts → novo/dir/arq.ts'
      })
    })

    it('renomeação entre arquivos sem pasta', () => {
      expect(diffPathParts('b.ts', 'a.ts')).toEqual({ prefix: 'a.ts → ', name: 'b.ts', title: 'a.ts → b.ts' })
    })

    it('oldPath ausente ou vazio não aparece: só renomeação mostra o caminho antigo', () => {
      expect(diffPathParts('src/a.ts', undefined)).toEqual({ prefix: 'src/', name: 'a.ts', title: 'src/a.ts' })
      expect(diffPathParts('src/a.ts', '')).toEqual({ prefix: 'src/', name: 'a.ts', title: 'src/a.ts' })
    })
  })
})
