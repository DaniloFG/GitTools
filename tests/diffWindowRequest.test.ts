import { describe, expect, it } from 'vitest'
import { isDiffWindowRequest } from '../src/backend/backend'

// O canal app:openDiffWindow recebe o pedido da interface: o processo principal confere o formato antes de abrir a janela.
describe('app:openDiffWindow: formato do pedido', () => {
  it('aceita os pedidos válidos das quatro origens, com oldPath, título e raiz opcionais', () => {
    expect(isDiffWindowRequest({ source: { kind: 'unstaged' }, path: 'a.txt' })).toBe(true)
    expect(isDiffWindowRequest({ source: { kind: 'staged', path: 'a.txt' }, path: 'a.txt' })).toBe(true)
    expect(isDiffWindowRequest({ source: { kind: 'commit', sha: 'abc123' }, path: 'b.txt', title: 'b', root: '/repo' })).toBe(true)
    expect(isDiffWindowRequest({ source: { kind: 'commit', sha: 'abc123', oldPath: 'a.txt' }, path: 'b.txt' })).toBe(true)
    expect(isDiffWindowRequest({ source: { kind: 'range', from: 'main', to: 'feat' }, path: 'x.txt' })).toBe(true)
    expect(isDiffWindowRequest({ source: { kind: 'staged', path: 'a.txt', fullFile: true, uncapped: false }, path: 'a.txt' })).toBe(true)
  })

  it('recusa o que não tem a forma do pedido: kind, sha, from/to, oldPath, title, root e path', () => {
    const invalidos: unknown[] = [
      undefined,
      null,
      'texto',
      { path: 'a.txt' },
      { source: { kind: 'unstaged' } },
      { source: 'unstaged', path: 'a.txt' },
      { source: { kind: 'bogus' }, path: 'a.txt' },
      { source: { kind: 123 }, path: 'a.txt' },
      { source: { kind: 'commit' }, path: 'a.txt' },
      { source: { kind: 'commit', sha: 123 }, path: 'a.txt' },
      { source: { kind: 'range', from: 'a' }, path: 'a.txt' },
      { source: { kind: 'range', from: 'a', to: {} }, path: 'a.txt' },
      { source: { kind: 'commit', sha: 'abc', oldPath: { x: 1 } }, path: 'a.txt' },
      { source: { kind: 'unstaged', oldPath: 5 }, path: 'a.txt' },
      { source: { kind: 'unstaged' }, path: 'a.txt', title: 1 },
      { source: { kind: 'unstaged' }, path: 'a.txt', root: ['/x'] },
      { source: { kind: 'commit', sha: 'abc' }, path: 7 },
      { source: { kind: 'unstaged', path: { x: 1 } }, path: 'a.txt' },
      { source: { kind: 'unstaged', fullFile: 'yes' }, path: 'a.txt' },
      { source: { kind: 'unstaged', uncapped: 1 }, path: 'a.txt' }
    ]
    for (const pedido of invalidos) expect(isDiffWindowRequest(pedido)).toBe(false)
  })
})
