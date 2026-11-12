import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path, { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveInside, resolveInsideParent, resolveInsideReal } from '../src/core/paths'
import { linkOrSkip } from './helpers'

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

  it('recusa pasta-link para fora com arquivo dentro (leitura e alvo que ainda não existe)', async (ctx) => {
    const { root, outside } = sandbox()
    linkOrSkip(ctx, outside, join(root, 'link'), 'junction')
    await expect(resolveInsideReal(root, 'link/fora.txt')).rejects.toThrow()
    await expect(resolveInsideReal(root, 'link/novo.txt')).rejects.toThrow()
  })

  it('recusa arquivo-link para fora, que o texto do caminho não denuncia', async (ctx) => {
    const { root, outside } = sandbox()
    linkOrSkip(ctx, join(outside, 'fora.txt'), join(root, 'atalho.txt'), 'file')
    await expect(resolveInsideReal(root, 'atalho.txt')).rejects.toThrow()
  })

  it('aceita pasta-link para dentro do repositório', async (ctx) => {
    const { root } = sandbox()
    linkOrSkip(ctx, join(root, 'src'), join(root, 'alias'), 'junction')
    await expect(resolveInsideReal(root, 'alias/a.txt')).resolves.toBe(join(root, 'alias', 'a.txt'))
  })

  it('aceita alvo inexistente dentro do repositório (para escrita de arquivo novo)', async () => {
    const { root } = sandbox()
    await expect(resolveInsideReal(root, 'src/novo/x.txt')).resolves.toBe(join(root, 'src', 'novo', 'x.txt'))
  })
})

// `resolveInsideParent` não segue o último componente: arquivo-link (para fora ou quebrado) é aceito, porque o
// chamador só o inspeciona (lstat). A pasta que o contém continua presa dentro do repositório.
describe('resolveInsideParent (último componente não é seguido)', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })

  /** Um repositório (raiz) com src/a.txt e uma pasta irmã, fora dele, com um arquivo "secreto". */
  function sandbox() {
    const base = mkdtempSync(join(tmpdir(), 'gittools-parent-'))
    dirs.push(base)
    const root = join(base, 'repo')
    const outside = join(base, 'fora')
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(outside)
    writeFileSync(join(root, 'src', 'a.txt'), 'dentro\n')
    writeFileSync(join(outside, 'fora.txt'), 'SEGREDO FORA\n')
    return { root, outside }
  }

  it('aceita arquivo-link para fora e link quebrado, devolvendo o caminho do próprio link', async (ctx) => {
    const { root, outside } = sandbox()
    linkOrSkip(ctx, join(outside, 'fora.txt'), join(root, 'atalho.txt'), 'file')
    linkOrSkip(ctx, join(outside, 'nao-existe.txt'), join(root, 'quebrado.txt'), 'file')
    await expect(resolveInsideParent(root, 'atalho.txt')).resolves.toBe(join(root, 'atalho.txt'))
    await expect(resolveInsideParent(root, 'quebrado.txt')).resolves.toBe(join(root, 'quebrado.txt'))
  })

  // Link em loop (a -> b -> a) e link para si mesmo: o último componente não é seguido, então a chamada devolve o
  // próprio caminho do link e termina, sem travar.
  it('aceita link em loop e link para si mesmo no último componente, sem seguir o link', async (ctx) => {
    const { root } = sandbox()
    linkOrSkip(ctx, join(root, 'b.txt'), join(root, 'a.txt'), 'file')
    linkOrSkip(ctx, join(root, 'a.txt'), join(root, 'b.txt'), 'file')
    linkOrSkip(ctx, join(root, 'self.txt'), join(root, 'self.txt'), 'file')
    await expect(resolveInsideParent(root, 'a.txt')).resolves.toBe(join(root, 'a.txt'))
    await expect(resolveInsideParent(root, 'b.txt')).resolves.toBe(join(root, 'b.txt'))
    await expect(resolveInsideParent(root, 'self.txt')).resolves.toBe(join(root, 'self.txt'))
  })

  it('recusa "../", caminho absoluto e pasta-link para fora (arquivo que existe ou não)', async (ctx) => {
    const { root, outside } = sandbox()
    linkOrSkip(ctx, outside, join(root, 'link'), 'junction')
    await expect(resolveInsideParent(root, '../fora/fora.txt')).rejects.toThrow()
    await expect(resolveInsideParent(root, join(outside, 'fora.txt'))).rejects.toThrow()
    await expect(resolveInsideParent(root, 'link/fora.txt')).rejects.toThrow()
    await expect(resolveInsideParent(root, 'link/novo.txt')).rejects.toThrow()
  })

  it('aceita pasta-link para dentro do repositório e a própria raiz', async (ctx) => {
    const { root } = sandbox()
    linkOrSkip(ctx, join(root, 'src'), join(root, 'alias'), 'junction')
    await expect(resolveInsideParent(root, 'alias/a.txt')).resolves.toBe(join(root, 'alias', 'a.txt'))
    await expect(resolveInsideParent(root, '.')).resolves.toBe(root)
  })
})
