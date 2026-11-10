import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findRepositories, isIgnoredPath } from '../src/core/discover'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** Pasta temporária com a estrutura pedida: `repo(...)` cria um .git (pasta), `worktree(...)` cria um .git arquivo. */
function workspace() {
  const base = mkdtempSync(join(tmpdir(), 'gittools-discover-'))
  dirs.push(base)
  const at = (...parts: string[]) => join(base, ...parts)
  const repo = (...parts: string[]) => {
    mkdirSync(join(base, ...parts, '.git'), { recursive: true })
    return join(base, ...parts)
  }
  const folder = (...parts: string[]) => {
    mkdirSync(join(base, ...parts), { recursive: true })
    return join(base, ...parts)
  }
  return { base, at, repo, folder }
}

describe('findRepositories', () => {
  it('encontra a própria pasta quando ela é um repositório', async () => {
    const w = workspace()
    const root = w.repo('projeto')
    expect(await findRepositories([root])).toEqual([root])
  })

  it('ignora uma pasta que não é repositório e não tem nenhum dentro', async () => {
    const w = workspace()
    expect(await findRepositories([w.folder('vazia')])).toEqual([])
  })

  it('acha repositórios aninhados nas subpastas, com as raízes primeiro e os demais em ordem alfabética', async () => {
    const w = workspace()
    const raiz = w.repo('raiz')
    const beta = w.repo('raiz', 'beta')
    const alfa = w.repo('raiz', 'alfa')
    const profundo = w.repo('raiz', 'grupo', 'sub', 'fundo')
    expect(await findRepositories([raiz])).toEqual([raiz, alfa, beta, profundo])
  })

  it('várias pastas do workspace (multi-root): as raízes na ordem recebida, sem repetir', async () => {
    const w = workspace()
    const primeira = w.repo('primeira')
    const segunda = w.repo('segunda')
    const dentroDaPrimeira = w.repo('primeira', 'modulo')
    // A mesma pasta passada duas vezes conta uma vez só.
    expect(await findRepositories([segunda, primeira, primeira])).toEqual([segunda, primeira, dentroDaPrimeira])
  })

  it('pasta de raiz que não é repositório mas tem repositórios dentro', async () => {
    const w = workspace()
    w.folder('monorepo')
    const a = w.repo('monorepo', 'a')
    const b = w.repo('monorepo', 'pacotes', 'b')
    expect(await findRepositories([w.at('monorepo')])).toEqual([a, b])
  })

  it('aceita .git como arquivo (worktrees e submódulos)', async () => {
    const w = workspace()
    const root = w.folder('principal')
    w.repo('principal')
    const worktree = w.folder('principal', 'worktrees', 'feature')
    writeFileSync(join(worktree, '.git'), 'gitdir: /algum/lugar/.git/worktrees/feature\n')
    expect(await findRepositories([root])).toEqual([root, worktree])
  })

  it('não desce em node_modules, dist, out, build, .venv, vendor e target', async () => {
    const w = workspace()
    const root = w.folder('app')
    for (const ignored of ['node_modules', 'dist', 'out', 'build', '.venv', 'vendor', 'target']) w.repo('app', ignored, 'pacote')
    const visivel = w.repo('app', 'src', 'modulo')
    expect(await findRepositories([root])).toEqual([visivel])
  })

  it('a própria raiz não é filtrada, mesmo que se chame build', async () => {
    const w = workspace()
    const root = w.repo('build')
    expect(await findRepositories([root])).toEqual([root])
  })

  it('respeita a profundidade máxima (padrão 4, a raiz é a profundidade 0)', async () => {
    const w = workspace()
    const root = w.folder('r')
    const quatro = w.repo('r', 'a', 'b', 'c', 'quatro')
    w.repo('r', 'a', 'b', 'c', 'd', 'cinco')
    expect(await findRepositories([root])).toEqual([quatro])
    expect(await findRepositories([root], { maxDepth: 2 })).toEqual([])
    expect(await findRepositories([root], { maxDepth: 5 })).toEqual([w.at('r', 'a', 'b', 'c', 'd', 'cinco'), quatro])
  })

  it('limita a quantidade de repositórios devolvidos, mantendo as raízes', async () => {
    const w = workspace()
    const raiz = w.repo('r')
    for (let i = 0; i < 10; i++) w.repo('r', `n${i}`)
    const found = await findRepositories([raiz], { limit: 4 })
    expect(found).toHaveLength(4)
    expect(found[0]).toBe(raiz)
  })

  it('não segue links simbólicos', async () => {
    const w = workspace()
    const root = w.folder('origem')
    const real = w.repo('externo')
    try {
      symlinkSync(real, join(root, 'atalho'), 'dir')
    } catch {
      // Sem permissão para criar links (ex.: Windows sem modo desenvolvedor): nada a testar aqui.
      return
    }
    expect(await findRepositories([root])).toEqual([])
  })

  it('pasta que não existe é ignorada sem erro', async () => {
    const w = workspace()
    expect(await findRepositories([w.at('nao-existe')])).toEqual([])
  })

  it('aceita opções de ignorados próprias', async () => {
    const w = workspace()
    const root = w.folder('x')
    w.repo('x', 'build', 'lib')
    const livre = w.repo('x', 'pastaqualquer')
    expect(await findRepositories([root], { ignore: ['pastaqualquer'] })).toEqual([w.at('x', 'build', 'lib')])
    expect(await findRepositories([root], { ignore: [] })).toEqual([w.at('x', 'build', 'lib'), livre])
  })

  it('isIgnoredPath reconhece caminhos que passam por uma pasta ignorada', () => {
    expect(isIgnoredPath('/home/u/projeto/node_modules/pacote/.git')).toBe(true)
    expect(isIgnoredPath('C:\\projetos\\app\\build\\x')).toBe(true)
    expect(isIgnoredPath('/home/u/projeto/src/app')).toBe(false)
  })
})
