import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path, { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveInside, resolveInsideReal } from '../src/core/paths'

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

// Em disco: um link dentro do repositório pode apontar para fora. O texto do caminho parece interno, então a
// barreira precisa olhar o caminho real. Junction é usada para pasta: no Windows não exige privilégio de administrador.
describe('resolveInsideReal (links em disco)', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })

  /** Um repositório (raiz) com src/a.txt e uma pasta irmã, fora dele, com um arquivo de conteúdo "secreto". */
  function sandbox() {
    const base = mkdtempSync(join(tmpdir(), 'gittools-paths-'))
    dirs.push(base)
    const root = join(base, 'repo')
    const outside = join(base, 'fora')
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(outside)
    writeFileSync(join(root, 'src', 'a.txt'), 'dentro\n')
    writeFileSync(join(outside, 'fora.txt'), 'SEGREDO FORA\n')
    return { root, outside }
  }

  it('recusa "../" e caminho absoluto, mesmo que o alvo exista', async () => {
    const { root, outside } = sandbox()
    await expect(resolveInsideReal(root, '../fora/fora.txt')).rejects.toThrow()
    await expect(resolveInsideReal(root, join(outside, 'fora.txt'))).rejects.toThrow()
  })

  it('recusa pasta-link para fora com arquivo dentro (leitura e alvo que ainda não existe)', async () => {
    const { root, outside } = sandbox()
    symlinkSync(outside, join(root, 'link'), 'junction')
    await expect(resolveInsideReal(root, 'link/fora.txt')).rejects.toThrow()
    await expect(resolveInsideReal(root, 'link/novo.txt')).rejects.toThrow()
  })

  it('recusa arquivo-link para fora, que o texto do caminho não denuncia', async () => {
    const { root, outside } = sandbox()
    symlinkSync(join(outside, 'fora.txt'), join(root, 'atalho.txt'), 'file')
    await expect(resolveInsideReal(root, 'atalho.txt')).rejects.toThrow()
  })

  it('aceita pasta-link para dentro do repositório', async () => {
    const { root } = sandbox()
    symlinkSync(join(root, 'src'), join(root, 'alias'), 'junction')
    await expect(resolveInsideReal(root, 'alias/a.txt')).resolves.toBe(join(root, 'alias', 'a.txt'))
  })

  it('aceita alvo inexistente dentro do repositório (para escrita de arquivo novo)', async () => {
    const { root } = sandbox()
    await expect(resolveInsideReal(root, 'src/novo/x.txt')).resolves.toBe(join(root, 'src', 'novo', 'x.txt'))
  })
})
