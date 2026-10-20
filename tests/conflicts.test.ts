import { describe, expect, it } from 'vitest'
import { buildResult, conflictCount, parseConflicts } from '../src/shared/conflicts'

const FILE = [
  'antes',
  '<<<<<<< HEAD',
  'nosso 1',
  'nosso 2',
  '=======',
  'deles',
  '>>>>>>> feature',
  'meio',
  '<<<<<<< HEAD',
  'a',
  '||||||| base',
  'b',
  '=======',
  'c',
  '>>>>>>> 1234567 (msg)',
  'fim',
  ''
].join('\n')

describe('parseConflicts', () => {
  const parsed = parseConflicts(FILE)

  it('separa trechos comuns e blocos em conflito', () => {
    expect(parsed.chunks.map((c) => c.kind)).toEqual(['common', 'conflict', 'common', 'conflict', 'common'])
    expect(conflictCount(parsed)).toBe(2)
    expect(parsed.chunks[1]).toMatchObject({ ours: ['nosso 1', 'nosso 2'], theirs: ['deles'], base: null, oursLabel: 'HEAD', theirsLabel: 'feature' })
    expect(parsed.chunks[3]).toMatchObject({ ours: ['a'], base: ['b'], theirs: ['c'] })
  })

  it('sem resolução, reconstrói o arquivo original', () => {
    expect(buildResult(parsed, [])).toBe(FILE.replace('||||||| base', '|||||||'))
  })

  it('aplica as escolhas de cada bloco', () => {
    const result = buildResult(parsed, [{ kind: 'theirs-ours' }, { kind: 'custom', text: 'x\ny' }])
    expect(result).toBe(['antes', 'deles', 'nosso 1', 'nosso 2', 'meio', 'x', 'y', 'fim', ''].join('\n'))
  })

  it('preserva CRLF e ausência de quebra final', () => {
    const p = parseConflicts('a\r\n<<<<<<< HEAD\r\nb\r\n=======\r\nc\r\n>>>>>>> x')
    expect(p.eol).toBe('\r\n')
    expect(buildResult(p, [{ kind: 'ours' }])).toBe('a\r\nb')
  })

  it('trata marcadores incompletos como texto comum', () => {
    const p = parseConflicts('<<<<<<< HEAD\nsó isso\n')
    expect(conflictCount(p)).toBe(0)
  })
})
