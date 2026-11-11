import { describe, expect, it } from 'vitest'
import { buildNameTree, listNameRows, treeNameRows, TREE_INDENT } from '../src/renderer/src/sidebarRows'

const byName = (item: { name: string }) => item.name
const items = (...names: string[]) => names.map((name) => ({ name }))

describe('sidebarRows', () => {
  it('lista: uma linha por item, na ordem dos dados, sem recuo', () => {
    const rows = listNameRows(items('main', 'feature/a', 'fix'), byName)
    expect(rows.map((r) => (r.kind === 'item' ? r.label : '?'))).toEqual(['main', 'feature/a', 'fix'])
    expect(rows.every((r) => r.kind === 'item' && r.indent === undefined)).toBe(true)
  })

  it('lista vazia não gera linhas', () => {
    expect(listNameRows([], byName)).toEqual([])
    expect(treeNameRows(buildNameTree([], byName), new Set())).toEqual([])
  })

  it('árvore sem barras: itens no mesmo nível, com o recuo de item', () => {
    const rows = treeNameRows(buildNameTree(items('main', 'fix'), byName), new Set())
    expect(rows).toEqual([
      { kind: 'item', item: { name: 'fix' }, label: 'fix', indent: 6 + 16 },
      { kind: 'item', item: { name: 'main' }, label: 'main', indent: 6 + 16 }
    ])
  })

  it('árvore: pasta antes dos itens, filhos com um nível a mais e contagem de arquivos da pasta', () => {
    const rows = treeNameRows(buildNameTree(items('feature/a', 'feature/b', 'fix'), byName), new Set())
    expect(rows).toEqual([
      { kind: 'dir', path: 'feature', name: 'feature', fileCount: 2, indent: 6, collapsed: false },
      { kind: 'item', item: { name: 'feature/a' }, label: 'a', indent: 6 + TREE_INDENT + 16 },
      { kind: 'item', item: { name: 'feature/b' }, label: 'b', indent: 6 + TREE_INDENT + 16 },
      { kind: 'item', item: { name: 'fix' }, label: 'fix', indent: 6 + 16 }
    ])
  })

  it('pasta recolhida esconde o conteúdo, mas continua na linha', () => {
    const rows = treeNameRows(buildNameTree(items('feature/a', 'feature/b', 'fix'), byName), new Set(['feature']))
    expect(rows.map((r) => (r.kind === 'dir' ? `dir ${r.path} ${r.collapsed}` : `item ${r.label}`))).toEqual(['dir feature true', 'item fix'])
  })

  it('cadeia de pastas com um só filho vira uma linha ("feature/x") e recolhe pelo caminho completo', () => {
    const tree = buildNameTree(items('feature/x/y', 'feature/x/z'), byName)
    const open = treeNameRows(tree, new Set())
    expect(open[0]).toMatchObject({ kind: 'dir', name: 'feature/x', path: 'feature/x', fileCount: 2 })
    expect(open).toHaveLength(3)
    const closed = treeNameRows(tree, new Set(['feature/x']))
    expect(closed).toHaveLength(1)
  })

  it('pastas de seções diferentes não se misturam: o conjunto recolhido vale só para a árvore dele', () => {
    const local = treeNameRows(buildNameTree(items('feature/a'), byName), new Set(['feature']))
    const other = treeNameRows(buildNameTree(items('feature/b'), byName), new Set())
    expect(local).toHaveLength(1)
    expect(other).toHaveLength(2)
  })
})
