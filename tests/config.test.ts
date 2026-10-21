import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cloneRepository, getIdentities, repoNameFromUrl, setIdentity } from '../src/core/config'
import { onGitCommand } from '../src/core/exec'
import type { GitCommandEntry } from '../src/shared/types'
import { createRepo } from './helpers'

const GLOBAL = process.env.GIT_CONFIG_GLOBAL
const dirs: string[] = []
afterEach(() => {
  if (GLOBAL === undefined) delete process.env.GIT_CONFIG_GLOBAL
  else process.env.GIT_CONFIG_GLOBAL = GLOBAL
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gittools-config-'))
  dirs.push(dir)
  return dir
}

describe('identidade git', () => {
  it('lê e grava nome e e-mail globais e do repositório', async () => {
    const home = tempDir()
    process.env.GIT_CONFIG_GLOBAL = join(home, '.gitconfig')
    const t = await createRepo()
    await t.git('config', '--unset', 'user.name')
    await t.git('config', '--unset', 'user.email')

    await setIdentity(home, t.dir, 'global', { name: 'Ana Global', email: 'ana@global.dev' })
    let ids = await getIdentities(home, t.dir)
    expect(ids.global).toEqual({ name: 'Ana Global', email: 'ana@global.dev' })
    expect(ids.local).toEqual({ name: '', email: '' })
    expect(ids.effective).toEqual({ name: 'Ana Global', email: 'ana@global.dev' })

    await setIdentity(home, t.dir, 'local', { name: 'Ana Projeto', email: 'ana@projeto.dev' })
    ids = await getIdentities(home, t.dir)
    expect(ids.effective).toEqual({ name: 'Ana Projeto', email: 'ana@projeto.dev' })

    // Texto vazio remove o valor do escopo; volta a valer o global.
    await setIdentity(home, t.dir, 'local', { name: '', email: '' })
    expect((await getIdentities(home, t.dir)).effective).toEqual({ name: 'Ana Global', email: 'ana@global.dev' })
    expect((await getIdentities(home, null)).local).toBeNull()
  })

  it('recusa e-mail inválido', async () => {
    const home = tempDir()
    process.env.GIT_CONFIG_GLOBAL = join(home, '.gitconfig')
    await expect(setIdentity(home, null, 'global', { name: 'X', email: 'sem arroba' })).rejects.toThrow()
    await expect(setIdentity(home, null, 'local', { name: 'X', email: 'x@y.z' })).rejects.toThrow()
  })
})

describe('git clone', () => {
  it('sugere o nome da pasta a partir da URL', () => {
    expect(repoNameFromUrl('https://github.com/DaniloFG/GitTools.git')).toBe('GitTools')
    expect(repoNameFromUrl('git@github.com:org/projeto.git')).toBe('projeto')
    expect(repoNameFromUrl('/caminho/local/repo/')).toBe('repo')
  })

  it('clona um repositório e recusa pasta existente', async () => {
    const source = await createRepo()
    await source.commit('init', { 'a.txt': 'a\n' })
    const parent = tempDir()
    const target = await cloneRepository(source.dir, parent, 'copia')
    expect(target).toBe(join(parent, 'copia'))
    expect(existsSync(join(target, 'a.txt'))).toBe(true)
    await expect(cloneRepository(source.dir, parent, 'copia')).rejects.toThrow()
    await expect(cloneRepository(source.dir, parent, '../fora')).rejects.toThrow()
    await expect(cloneRepository('', parent, 'x')).rejects.toThrow()
  })
})

describe('log de comandos', () => {
  it('avisa o início e o fim de cada comando, com duração e erro', async () => {
    const t = await createRepo()
    const seen: GitCommandEntry[] = []
    const stop = onGitCommand((e) => seen.push(e))
    await t.repo.status()
    await t.repo.checkout('nao-existe').catch(() => undefined)
    stop()
    const status = seen.filter((e) => e.args[0] === 'status')
    expect(status).toHaveLength(2)
    expect(status[0].durationMs).toBeUndefined()
    expect(status[1]).toMatchObject({ id: status[0].id, exitCode: 0 })
    expect(status[1].durationMs).toBeGreaterThanOrEqual(0)
    const failed = seen.find((e) => e.args[0] === 'checkout' && e.exitCode !== undefined)
    expect(failed?.exitCode).not.toBe(0)
    expect(failed?.failed).toBe(true)
    expect(failed?.error).toBeTruthy()
  })
})
