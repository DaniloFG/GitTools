import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cloneRepository, getIdentities, repoNameFromUrl, setIdentity } from '../src/core/config'
import { onGitCommand, runGit } from '../src/core/exec'
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

describe('remotes', () => {
  it('adiciona, lista, altera, renomeia e remove remotes', async () => {
    const { repo } = await createRepo()
    expect(await repo.remotes()).toEqual([])
    expect(await repo.addRemote('origin', 'https://example.com/a.git')).toBe('origin')
    await repo.addRemote('upstream', 'git@example.com:org/a.git')
    expect(await repo.remotes()).toEqual([
      { name: 'origin', fetchUrl: 'https://example.com/a.git', pushUrl: 'https://example.com/a.git', pushUrls: ['https://example.com/a.git'], customPush: false },
      { name: 'upstream', fetchUrl: 'git@example.com:org/a.git', pushUrl: 'git@example.com:org/a.git', pushUrls: ['git@example.com:org/a.git'], customPush: false }
    ])
    await repo.setRemoteUrl('upstream', 'https://example.com/b.git')
    await repo.renameRemote('upstream', 'fork')
    expect((await repo.remotes()).map((r) => [r.name, r.fetchUrl])).toEqual([
      ['fork', 'https://example.com/b.git'],
      ['origin', 'https://example.com/a.git']
    ])
    await repo.removeRemote('fork')
    expect((await repo.remotes()).map((r) => r.name)).toEqual(['origin'])
  })

  it('lista vários destinos de envio por remote (issue #18) e permite acrescentar e tirar URLs', async () => {
    const { repo } = await createRepo()
    await repo.addRemote('origin', 'https://github.com/u/a.git')
    await repo.addRemote('upstream', 'https://example.com/up.git')

    // Primeira URL de envio extra: a de baixar continua recebendo o push.
    await repo.addRemoteUrl('origin', 'https://gitlab.com/u/a.git')
    const origin = (await repo.remotes()).find((r) => r.name === 'origin')!
    expect(origin.fetchUrl).toBe('https://github.com/u/a.git')
    expect(origin.pushUrls).toEqual(['https://github.com/u/a.git', 'https://gitlab.com/u/a.git'])
    expect(origin.pushUrl).toBe('https://github.com/u/a.git')
    expect(origin.customPush).toBe(true)
    // O outro remote não foi tocado.
    expect((await repo.remotes()).find((r) => r.name === 'upstream')).toMatchObject({ pushUrls: ['https://example.com/up.git'], customPush: false })

    await repo.addRemoteUrl('origin', 'ssh://git@example.org/a.git')
    expect((await repo.remotes())[0].pushUrls).toHaveLength(3)
    await expect(repo.addRemoteUrl('origin', 'ssh://git@example.org/a.git')).rejects.toThrow()

    await repo.removeRemoteUrl('origin', 'https://gitlab.com/u/a.git')
    expect((await repo.remotes())[0].pushUrls).toEqual(['https://github.com/u/a.git', 'ssh://git@example.org/a.git'])
    await expect(repo.removeRemoteUrl('origin', 'https://nao-existe.com/a.git')).rejects.toThrow()
    await expect(repo.addRemoteUrl('nenhum', 'https://example.com/x.git')).rejects.toThrow()
    await expect(repo.addRemoteUrl('origin', '--upload-pack=x')).rejects.toThrow()
  })

  it('o push vai para todas as URLs de envio do remote', async () => {
    const t = await createRepo()
    const first = tempDir()
    const second = tempDir()
    await runGit(first, ['init', '-q', '--bare'])
    await runGit(second, ['init', '-q', '--bare'])
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    await t.repo.addRemote('origin', first)
    await t.repo.addRemoteUrl('origin', second)
    await t.repo.push('origin')
    for (const dir of [first, second]) {
      const log = await runGit(dir, ['log', '--format=%s', '--all'])
      expect(log.stdout.trim()).toBe('primeiro')
    }
  })

  it('recusa nomes e URLs que o git leria como opção', async () => {
    const { repo } = await createRepo()
    await expect(repo.addRemote('--mirror', 'https://example.com/a.git')).rejects.toThrow()
    await expect(repo.addRemote('bad name', 'https://example.com/a.git')).rejects.toThrow()
    await expect(repo.addRemote('ok', '--upload-pack=touch /tmp/x')).rejects.toThrow()
    await expect(repo.addRemote('ok', '   ')).rejects.toThrow()
    expect(await repo.remotes()).toEqual([])
  })

  it('envia para o remote escolhido e baixa o novo remote quando pedido', async () => {
    const t = await createRepo()
    const bare = tempDir()
    await runGit(bare, ['init', '-q', '--bare', '-b', 'main'])
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    await t.repo.addRemote('backup', bare)
    await t.repo.push('backup')
    expect((await runGit(bare, ['log', '--format=%s', 'main'])).stdout.trim()).toBe('primeiro')
    await t.repo.removeRemote('backup')
    await t.repo.addRemote('backup', bare, true)
    expect((await t.repo.branches()).some((b) => b.name === 'backup/main')).toBe(true)
  })
})
