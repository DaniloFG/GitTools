import { describe, expect, it } from 'vitest'
import { caretPosition, detectIndent, fromFile, lineOrigins, lineText, toFile, visualColumn } from '../src/renderer/src/editorText'

describe('texto do editor', () => {
  it('preserva a quebra de linha e o BOM do arquivo ao salvar', () => {
    const crlf = fromFile('﻿a\r\nb\r\n')
    expect(crlf).toEqual({ text: 'a\nb\n', eol: '\r\n', bom: true })
    expect(toFile('a\nB\nc\n', crlf)).toBe('﻿a\r\nB\r\nc\r\n')
    const lf = fromFile('a\nb\n')
    expect(lf).toMatchObject({ eol: '\n', bom: false })
    expect(toFile(lf.text, lf)).toBe('a\nb\n')
    // Sem alterar nada, o arquivo sai idêntico.
    for (const raw of ['', 'sem quebra', 'x\r\ny\r\n', 'x\ny\n\n']) expect(toFile(fromFile(raw).text, fromFile(raw))).toBe(raw)
  })

  it('acha a linha e a coluna do cursor', () => {
    const text = 'um\ndois\n\nquatro'
    expect(caretPosition(text, 0)).toEqual({ line: 1, column: 0 })
    expect(caretPosition(text, 2)).toEqual({ line: 1, column: 2 })
    expect(caretPosition(text, 3)).toEqual({ line: 2, column: 0 })
    expect(caretPosition(text, 8)).toEqual({ line: 3, column: 0 })
    expect(caretPosition(text, 99)).toEqual({ line: 4, column: 6 })
    expect([1, 2, 3, 4, 5].map((n) => lineText(text, n))).toEqual(['um', 'dois', '', 'quatro', ''])
  })

  it('conta a tabulação até o próximo múltiplo da largura', () => {
    expect(visualColumn('abc', 3)).toBe(3)
    expect(visualColumn('\tabc', 4)).toBe(7)
    expect(visualColumn('ab\tc', 4)).toBe(5)
    expect(visualColumn('ab\tc', 3)).toBe(4)
  })

  it('detecta o recuo do arquivo', () => {
    expect(detectIndent('a\n\tb\n\t\tc')).toBe('\t')
    expect(detectIndent('a\n    b\n        c')).toBe('    ')
    expect(detectIndent('a\n  b\n    c')).toBe('  ')
    expect(detectIndent('sem recuo')).toBe('  ')
  })
})

describe('origem das linhas editadas', () => {
  const lines = (...l: string[]) => l.join('\n')

  it('sem alterações, cada linha vem dela mesma', () => {
    expect(lineOrigins('a\nb\nc', 'a\nb\nc')).toEqual([1, 2, 3])
  })

  it('linhas escritas ou alteradas não têm origem; as outras acompanham o deslocamento', () => {
    expect(lineOrigins(lines('a', 'b', 'c'), lines('a', 'novo', 'b', 'c'))).toEqual([1, null, 2, 3])
    expect(lineOrigins(lines('a', 'b', 'c'), lines('a', 'B', 'c'))).toEqual([1, null, 3])
    expect(lineOrigins(lines('a', 'b', 'c'), lines('a', 'c'))).toEqual([1, 3])
    expect(lineOrigins(lines('a', 'b', 'c'), lines('x', 'a', 'b', 'c', 'y'))).toEqual([null, 1, 2, 3, null])
  })

  it('duas edições separadas não marcam o que há entre elas', () => {
    const before = lines('1', '2', '3', '4', '5', '6')
    const after = lines('1', 'dois', '3', '4', '5', 'seis')
    expect(lineOrigins(before, after)).toEqual([1, null, 3, 4, 5, null])
  })

  it('arquivo vazio e texto totalmente novo', () => {
    expect(lineOrigins('', '')).toEqual([1])
    expect(lineOrigins('', 'a\nb')).toEqual([null, null])
    expect(lineOrigins('a\nb', '')).toEqual([null])
  })
})
