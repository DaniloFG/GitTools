import { describe, expect, it } from 'vitest'
import { buildTree, flattenTree, parseFileViewMode, splitPath } from '../src/renderer/src/fileTree'

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
