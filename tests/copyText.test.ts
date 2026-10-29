import { describe, expect, it } from 'vitest'
import { diffLinesText, markedDiffLines } from '../src/renderer/src/copyText'
import { keepsNativeEdit } from '../src/renderer/src/shortcuts'
import type { DiffHunk, DiffLine, FileDiff } from '../src/shared/types'

const line = (kind: DiffLine['kind'], content: string, oldLine: number | null, newLine: number | null): DiffLine => ({ kind, content, oldLine, newLine })

const hunks: DiffHunk[] = [
  {
    oldStart: 1,
    oldCount: 2,
    newStart: 1,
    newCount: 2,
    section: '',
    lines: [line('context', 'const a = 1', 1, 1), line('del', 'let b = 2', 2, null), line('add', 'let b = 3', null, 2)]
  },
  {
    oldStart: 10,
    oldCount: 1,
    newStart: 10,
    newCount: 2,
    section: 'função',
    lines: [line('context', '', 10, 10), line('add', 'return b', null, 11)]
  }
]

describe('texto copiado de diffs', () => {
  it('copia só o código, uma linha por linha, sem números nem sinais', () => {
    expect(diffLinesText(hunks[0].lines)).toBe('const a = 1\nlet b = 2\nlet b = 3')
    expect(diffLinesText([hunks[0].lines[1]])).toBe('let b = 2')
  })

  it('linha vazia continua vazia (sem espaço nem quebra extra)', () => {
    expect(diffLinesText(hunks[1].lines)).toBe('\nreturn b')
    expect(diffLinesText([])).toBe('')
  })

  it('linhas marcadas saem na ordem do diff, de hunks diferentes', () => {
    const file = { hunks } as Pick<FileDiff, 'hunks'>
    // Chaves no formato "hunk:linha", como na seleção do diff.
    const marked = new Set(['1:1', '0:2', '0:1'])
    expect(diffLinesText(markedDiffLines(file, marked))).toBe('let b = 2\nlet b = 3\nreturn b')
    expect(markedDiffLines(file, new Set())).toEqual([])
  })
})

describe('atalhos de edição não são roubados do texto', () => {
  it('Ctrl+C/V/A continuam nativos em campos de texto ou com trecho selecionado', () => {
    expect(keepsNativeEdit('Ctrl+C', true, false)).toBe(true)
    expect(keepsNativeEdit('Ctrl+V', false, true)).toBe(true)
    expect(keepsNativeEdit('Ctrl+A', true, true)).toBe(true)
  })

  it('sem campo e sem seleção, ou fora das teclas de edição, o atalho segue normal', () => {
    expect(keepsNativeEdit('Ctrl+C', false, false)).toBe(false)
    expect(keepsNativeEdit('Ctrl+F', true, true)).toBe(false)
    expect(keepsNativeEdit('F5', true, true)).toBe(false)
  })
})
