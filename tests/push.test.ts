import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit } from '../src/core/exec'
import { createRepo } from './helpers'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gittools-push-'))
  dirs.push(dir)
  return dir
}

/** Repositório com um remote "origin" (bare) e o primeiro commit já enviado. */
async function withRemote() {
  const t = await createRepo()
  const bare = tempDir()
  await runGit(bare, ['init', '-q', '--bare', '-b', 'main'])
  await t.commit('primeiro', { 'a.txt': 'a\n' })
  await t.repo.addRemote('origin', bare)
  await t.repo.push()
  const remoteLog = async (ref = 'main') => (await runGit(bare, ['log', '--format=%s', ref])).stdout.trim().split('\n')
  return { ...t, bare, remoteLog }
}

describe('push com force', () => {
  it('recusa o push comum depois de um amend, e o force-with-lease o aceita', async () => {
    const t = await withRemote()
    t.write('a.txt', 'a2\n')
    await t.git('add', '-A')
    await t.repo.commit('primeiro (corrigido)', true)
    await expect(t.repo.push()).rejects.toThrow()
    expect(await t.remoteLog()).toEqual(['primeiro'])
    await t.repo.push(undefined, { force: 'lease' })
    expect(await t.remoteLog()).toEqual(['primeiro (corrigido)'])
  })

  it('o force-with-lease recusa quando alguém enviou algo que não conhecemos; o force sobrescreve', async () => {
    const t = await withRemote()
    // Outro clone envia um commit novo para o remote.
    const other = tempDir()
    await runGit(other, ['clone', '-q', t.bare, '.'])
    await runGit(other, ['-c', 'user.name=Outro', '-c', 'user.email=o@example.com', 'commit', '-q', '--allow-empty', '-m', 'do outro'])
    await runGit(other, ['push', '-q', 'origin', 'main'])

    t.write('a.txt', 'a2\n')
    await t.git('add', '-A')
    await t.repo.commit('primeiro (corrigido)', true)
    await expect(t.repo.push(undefined, { force: 'lease' })).rejects.toThrow()
    expect(await t.remoteLog()).toEqual(['do outro', 'primeiro'])
    await t.repo.push(undefined, { force: 'force' })
    expect(await t.remoteLog()).toEqual(['primeiro (corrigido)'])
  })

  it('envia outra branch sem trocar de branch, respeitando o upstream dela', async () => {
    const t = await withRemote()
    await t.repo.createBranch('feature', undefined, false)
    expect((await t.repo.status()).branch).toBe('main')
    await t.repo.push(undefined, { branch: 'feature' })
    expect(await t.remoteLog('feature')).toEqual(['primeiro'])
    expect((await t.repo.status()).branch).toBe('main')
    expect((await t.repo.branches()).find((b) => b.name === 'feature')?.upstream).toBe('origin/feature')

    // Reescreve a feature e, de outra branch, força o envio dela.
    await t.git('checkout', '-q', 'feature')
    await t.commit('na feature', { 'f.txt': 'f\n' })
    await t.repo.push()
    await t.git('reset', '-q', '--hard', 'HEAD~1')
    await t.commit('outro rumo', { 'g.txt': 'g\n' })
    await t.git('checkout', '-q', 'main')
    await expect(t.repo.push(undefined, { branch: 'feature' })).rejects.toThrow()
    await t.repo.push(undefined, { branch: 'feature', force: 'lease' })
    expect(await t.remoteLog('feature')).toEqual(['outro rumo', 'primeiro'])
  })

  it('não aceita branch inexistente nem nome malformado', async () => {
    const t = await withRemote()
    await expect(t.repo.push(undefined, { branch: 'nao-existe' })).rejects.toThrow()
    await expect(t.repo.push(undefined, { branch: '--delete' })).rejects.toThrow()
  })

  it('log de um repositório sem commits continua vazio', async () => {
    const t = await createRepo()
    expect(await t.repo.log()).toEqual([])
    expect(await t.repo.log({ all: true })).toEqual([])
  })
})
