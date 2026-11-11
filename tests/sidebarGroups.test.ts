import { describe, expect, it } from 'vitest'
import { groupBranches } from '../src/renderer/src/sidebarGroups'
import type { BranchInfo } from '../src/shared/types'

const branch = (name: string, remote: string | null = null): BranchInfo => ({
  name: remote ? `${remote}/${name}` : name,
  fullRef: remote ? `refs/remotes/${remote}/${name}` : `refs/heads/${name}`,
  remote,
  sha: 'a'.repeat(40),
  upstream: null,
  ahead: 0,
  behind: 0,
  current: false,
  date: 1,
  subject: 'assunto'
})

/** Implementação anterior do painel (referência): filter + Map copiando a lista a cada item. */
function oldGroup(branches: BranchInfo[]) {
  const local = branches.filter((b) => !b.remote)
  const remotes = new Map<string, BranchInfo[]>()
  for (const b of branches.filter((b) => b.remote)) {
    remotes.set(b.remote!, [...(remotes.get(b.remote!) ?? []), b])
  }
  return { local, remotes: [...remotes.entries()] }
}

describe('sidebarGroups', () => {
  it('lista vazia', () => {
    expect(groupBranches([])).toEqual({ local: [], remotes: [] })
    expect(groupBranches([])).toEqual(oldGroup([]))
  })

  it('só locais', () => {
    const list = [branch('main'), branch('feature/a'), branch('fix')]
    expect(groupBranches(list)).toEqual(oldGroup(list))
    expect(groupBranches(list).remotes).toEqual([])
  })

  it('locais e remotas de 3 remotos intercalados', () => {
    const list = [
      branch('main'),
      branch('main', 'origin'),
      branch('x', 'upstream'),
      branch('feature/a'),
      branch('y', 'origin'),
      branch('z', 'fork'),
      branch('fix'),
      branch('w', 'upstream')
    ]
    expect(groupBranches(list)).toEqual(oldGroup(list))
  })

  it('um remoto só', () => {
    const list = [branch('main'), branch('a', 'origin'), branch('b', 'origin')]
    expect(groupBranches(list)).toEqual(oldGroup(list))
    expect(groupBranches(list).remotes.map(([remote]) => remote)).toEqual(['origin'])
  })

  it('a ordem dos remotos é a da primeira aparição, e cada lista mantém a ordem original', () => {
    const list = [branch('b1', 'upstream'), branch('a1', 'origin'), branch('b2', 'upstream'), branch('a2', 'origin'), branch('c1', 'fork')]
    const { remotes } = groupBranches(list)
    expect(remotes.map(([remote]) => remote)).toEqual(['upstream', 'origin', 'fork'])
    expect(remotes[0][1].map((b) => b.name)).toEqual(['upstream/b1', 'upstream/b2'])
    expect(remotes[1][1].map((b) => b.name)).toEqual(['origin/a1', 'origin/a2'])
  })

  it('1.100 branches geradas (300 locais, 800 remotas em 2 remotos)', () => {
    const list = Array.from({ length: 1100 }, (_, i) => {
      if (i < 300) return branch(`feature/x-${i}`)
      return branch(`feature/x-${i}`, i % 2 ? 'origin' : 'upstream')
    })
    const grouped = groupBranches(list)
    expect(grouped).toEqual(oldGroup(list))
    expect(grouped.local).toHaveLength(300)
    expect(grouped.remotes.map(([, l]) => l.length)).toEqual([400, 400])
  })
})
