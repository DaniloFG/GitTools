import { describe, expect, it } from 'vitest'
import { sameDiff } from '../../src/renderer/src/diffIdentity'
import type { DiffHunk, FileDiff } from '../../src/shared/types'

const hunk = (lines: string[] = ['a', 'b']): DiffHunk => ({
  oldStart: 1,
  oldCount: lines.length,
  newStart: 1,
  newCount: lines.length,
  section: 'fn()',
  lines: lines.map((content, i) => ({ kind: 'context', content, oldLine: i + 1, newLine: i + 1 }))
})

/** Diff de um arquivo rastreado, com o cabeçalho `index` que o git escreve. */
const tracked = (over: Partial<FileDiff> = {}): FileDiff => ({
  oldPath: 'src/a.ts',
  newPath: 'src/a.ts',
  path: 'src/a.ts',
  changeType: 'modified',
  binary: false,
  headerLines: ['diff --git a/src/a.ts b/src/a.ts', 'index 3f2a1b0..9c8d7e6 100644', '--- a/src/a.ts', '+++ b/src/a.ts'],
  hunks: [hunk()],
  additions: 1,
  deletions: 1,
  ...over
})

/** Arquivo não rastreado, montado em `untrackedDiff`: sem `index`. */
const untracked = (over: Partial<FileDiff> = {}): FileDiff => ({
  oldPath: null,
  newPath: 'novo.ts',
  path: 'novo.ts',
  changeType: 'added',
  binary: false,
  headerLines: ['diff --git a/novo.ts b/novo.ts', 'new file mode 100644', '--- /dev/null', '+++ b/novo.ts'],
  hunks: [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 2, section: '', lines: [
    { kind: 'add', content: 'x', oldLine: null, newLine: 1 },
    { kind: 'add', content: 'y', oldLine: null, newLine: 2 }
  ] }],
  additions: 2,
  deletions: 0,
  ...over
})

describe('sameDiff', () => {
  it('diffs iguais em objetos distintos são iguais', () => {
    expect(sameDiff(tracked(), tracked())).toBe(true)
    expect(sameDiff(untracked(), untracked())).toBe(true)
  })

  it('a mesma referência é igual', () => {
    const d = tracked()
    expect(sameDiff(d, d)).toBe(true)
  })

  it('mudança em cada campo escalar é diferente', () => {
    const base = tracked()
    const changes: Partial<FileDiff>[] = [
      { path: 'outro.ts' },
      { oldPath: 'x.ts' },
      { newPath: 'x.ts' },
      { changeType: 'renamed' },
      { binary: true },
      { truncated: true },
      { additions: 2 },
      { deletions: 0 }
    ]
    for (const change of changes) expect(sameDiff(base, tracked(change))).toBe(false)
  })

  it('headerLine diferente (hash do index diferente) é diferente', () => {
    const other = tracked({
      headerLines: ['diff --git a/src/a.ts b/src/a.ts', 'index 3f2a1b0..1111111 100644', '--- a/src/a.ts', '+++ b/src/a.ts']
    })
    expect(sameDiff(tracked(), other)).toBe(false)
  })

  it('mesmo index mas lines.length de um hunk diferente é diferente', () => {
    const longer = tracked({ hunks: [hunk(['a', 'b', 'c'])] })
    expect(sameDiff(tracked(), longer)).toBe(false)
  })

  it('mesmo index e mesmo tamanho: o atalho considera iguais sem olhar as linhas (o hash já garante o conteúdo)', () => {
    // Caso artificial: o git nunca escreveria o mesmo `index` para conteúdos diferentes. O teste fixa que as linhas
    // não são percorridas quando há `index`, que é o que faz a comparação ser rápida em diffs de 5.000 linhas.
    const sameIndexOtherText = tracked({ hunks: [hunk(['a', 'X'])] })
    expect(sameDiff(tracked(), sameIndexOtherText)).toBe(true)
  })

  it('não rastreado: uma linha de texto diferente é diferente, e igual é igual', () => {
    const changed = untracked({
      hunks: [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 2, section: '', lines: [
        { kind: 'add', content: 'x', oldLine: null, newLine: 1 },
        { kind: 'add', content: 'Y', oldLine: null, newLine: 2 }
      ] }]
    })
    expect(sameDiff(untracked(), changed)).toBe(false)
    expect(sameDiff(untracked(), untracked())).toBe(true)
  })

  it('não rastreado: kind, número de linha e noNewline também contam', () => {
    const base = untracked()
    const withNoNewline = untracked({
      hunks: [{ ...base.hunks[0], lines: [base.hunks[0].lines[0], { ...base.hunks[0].lines[1], noNewline: true }] }]
    })
    expect(sameDiff(base, withNoNewline)).toBe(false)
    const otherLine = untracked({
      hunks: [{ ...base.hunks[0], lines: [base.hunks[0].lines[0], { ...base.hunks[0].lines[1], newLine: 3 }] }]
    })
    expect(sameDiff(base, otherLine)).toBe(false)
  })

  it('binário sem hunks: iguais são iguais', () => {
    const bin = (): FileDiff => ({ ...tracked(), binary: true, hunks: [], additions: 0, deletions: 0 })
    expect(sameDiff(bin(), bin())).toBe(true)
  })

  it('truncated undefined e false são iguais; true e undefined são diferentes', () => {
    expect(sameDiff(tracked({ truncated: undefined }), tracked({ truncated: false }))).toBe(true)
    expect(sameDiff(tracked({ truncated: true }), tracked({ truncated: undefined }))).toBe(false)
  })

  it('quantidade de hunks ou de headerLines diferente é diferente', () => {
    expect(sameDiff(tracked(), tracked({ hunks: [hunk(), hunk()] }))).toBe(false)
    expect(sameDiff(tracked(), tracked({ headerLines: ['diff --git a/src/a.ts b/src/a.ts'] }))).toBe(false)
  })
})
