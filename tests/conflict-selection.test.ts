import { describe, expect, it } from 'vitest'
import { effectiveTab, keepSelection, type ConflictRow } from '../src/renderer/src/conflictRows'

function row(path: string): ConflictRow {
  return { path, kind: 'bothModified', resolved: null }
}

describe('keepSelection', () => {
  it('sem seleção, continua sem seleção', () => {
    expect(keepSelection([row('a.ts')], null)).toBeNull()
    expect(keepSelection([], null)).toBeNull()
  })

  it('mantém o arquivo que ainda está em conflito', () => {
    expect(keepSelection([row('a.ts'), row('b.ts')], 'b.ts')).toBe('b.ts')
  })

  it('limpa a seleção quando o arquivo saiu do conflito (resolvido)', () => {
    expect(keepSelection([row('a.ts')], 'b.ts')).toBeNull()
  })

  it('limpa a seleção quando não sobrou nenhum conflito', () => {
    expect(keepSelection([], 'a.ts')).toBeNull()
  })
})

describe('effectiveTab', () => {
  it('com arquivo selecionado, vale a aba escolhida', () => {
    expect(effectiveTab('a.ts', 'editor')).toBe('editor')
    expect(effectiveTab('a.ts', 'list')).toBe('list')
  })

  it('sem arquivo selecionado, a aba Editor volta para a lista', () => {
    expect(effectiveTab(null, 'editor')).toBe('list')
    expect(effectiveTab(null, 'list')).toBe('list')
  })
})
