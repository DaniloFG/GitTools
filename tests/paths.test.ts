import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveInside } from '../src/core/paths'

describe('resolveInside', () => {
  it('resolve um caminho relativo para absoluto dentro da raiz', () => {
    expect(resolveInside('/repo', 'src/app.ts', path.posix)).toBe('/repo/src/app.ts')
    expect(resolveInside('/repo', '.', path.posix)).toBe('/repo')
  })

  it('recusa caminhos que saem da raiz', () => {
    expect(() => resolveInside('/repo', '../outro/x', path.posix)).toThrow()
    expect(() => resolveInside('/repo', '/etc/passwd', path.posix)).toThrow()
    expect(() => resolveInside('/repo', 'a/../../x', path.posix)).toThrow()
  })

  it('aceita a raiz do git no Windows, que vem com barras normais', () => {
    expect(resolveInside('C:/Users/ana/projeto', 'src/app.ts', path.win32)).toBe('C:\\Users\\ana\\projeto\\src\\app.ts')
    expect(() => resolveInside('C:/Users/ana/projeto', '..\\outro\\x', path.win32)).toThrow()
    expect(() => resolveInside('C:/Users/ana/projeto', 'D:\\x', path.win32)).toThrow()
  })

  it('não confunde pastas com o mesmo prefixo', () => {
    expect(() => resolveInside('/repo', '../repo-2/x', path.posix)).toThrow()
  })
})
