import { describe, expect, it } from 'vitest'
import { buildTree, flattenTree } from '../src/renderer/src/fileTree'

/** Branches como o painel lateral mostra no modo árvore: o nome (sem o remoto) separado por "/". */
const branches = ['main', 'feature/login', 'feature/login-ui', 'claude/gittools-x', 'claude/y', 'fix']

describe('branches em árvore (painel lateral)', () => {
  it('agrupa branches com "/" em pastas e deixa as demais no nível de cima', () => {
    const tree = buildTree(branches, (b) => b)
    expect(tree.map((n) => `${n.kind}:${n.name}`)).toEqual(['dir:claude', 'dir:feature', 'file:fix', 'file:main'])
    const feature = tree[1]
    expect(feature.kind === 'dir' && feature.children.map((n) => n.name)).toEqual(['login', 'login-ui'])
    expect(feature.kind === 'dir' && feature.fileCount).toBe(2)
  })

  it('recolher uma pasta esconde as branches dela e mantém o item da branch', () => {
    const tree = buildTree(branches, (b) => b)
    const rows = flattenTree(tree, new Set(['feature']))
    expect(rows.map((r) => (r.kind === 'dir' ? `dir:${r.node.path}` : `file:${r.node.path}`))).toEqual([
      'dir:claude',
      'file:claude/gittools-x',
      'file:claude/y',
      'dir:feature',
      'file:fix',
      'file:main'
    ])
  })

  it('o item da árvore guarda a branch original para as ações', () => {
    const items = [{ name: 'feature/login', sha: 'a1' }]
    const rows = flattenTree(buildTree(items, (b) => b.name), new Set())
    const file = rows.find((r) => r.kind === 'file')
    expect(file?.kind === 'file' && file.node.item).toEqual({ name: 'feature/login', sha: 'a1' })
  })
})
