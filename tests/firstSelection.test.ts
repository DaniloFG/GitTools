import { describe, expect, it } from 'vitest'
import { firstChange } from '../src/renderer/src/changeEntries'
import { firstFileShown } from '../src/renderer/src/fileTree'
import type { FileStatus } from '../src/shared/types'

const file = (path: string): FileStatus => ({ path, index: '.', worktree: 'M', untracked: false, conflicted: false })

describe('primeiro arquivo da aba Alterações', () => {
  it('nada alterado não escolhe nada', () => {
    expect(firstChange({ staged: [], unstaged: [] })).toBeNull()
  })

  it('prefere o primeiro não staged', () => {
    expect(firstChange({ staged: [file('a.ts')], unstaged: [file('b.ts'), file('c.ts')] })).toEqual({ area: 'unstaged', path: 'b.ts' })
  })

  it('sem não staged, usa o primeiro staged', () => {
    expect(firstChange({ staged: [file('a.ts')], unstaged: [] })).toEqual({ area: 'staged', path: 'a.ts' })
  })
})

describe('primeiro arquivo da lista de arquivos', () => {
  const paths = ['zeta.md', 'src/b.ts', 'src/a.ts', 'alpha.ts']

  it('lista vazia não escolhe nada', () => {
    expect(firstFileShown([], 'list')).toBeNull()
    expect(firstFileShown([], 'tree')).toBeNull()
  })

  it('na lista, é o primeiro da ordem exibida', () => {
    expect(firstFileShown(paths, 'list')).toBe('zeta.md')
  })

  it('na árvore, é o primeiro arquivo como aparece (pastas antes dos arquivos soltos)', () => {
    expect(firstFileShown(paths, 'tree')).toBe('src/a.ts')
  })
})
