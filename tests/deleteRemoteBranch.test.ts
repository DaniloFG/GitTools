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

/** Repositório com um remoto "origin" (bare) que já tem `main` e `feature/x`, ambas buscadas (há `origin/feature/x` local). */
async function withRemote() {
  const t = await createRepo()
  const bare = mkdtempSync(join(tmpdir(), 'gittools-delremote-'))
  dirs.push(bare)
  await runGit(bare, ['init', '-q', '--bare', '-b', 'main'])
  await t.commit('primeiro', { 'a.txt': 'a\n' })
  await t.repo.addRemote('origin', bare)
  await t.git('branch', 'feature/x')
  await t.git('push', '-q', 'origin', 'main', 'feature/x')
  await t.git('fetch', '-q', 'origin')
  const remoteHeads = async () =>
    (await runGit(bare, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).stdout.split('\n').filter(Boolean).sort()
  const localRemoteRefs = async () =>
    (await t.git('for-each-ref', '--format=%(refname:short)', 'refs/remotes')).split('\n').filter(Boolean).sort()
  return { ...t, bare, remoteHeads, localRemoteRefs }
}

describe('deleteRemoteBranch', () => {
  it('apaga a branch no remoto e a referência de rastreamento local; a branch local fica', async () => {
    const t = await withRemote()
    expect(await t.remoteHeads()).toEqual(['feature/x', 'main'])
    expect(await t.localRemoteRefs()).toContain('origin/feature/x')

    await t.repo.deleteRemoteBranch('origin', 'feature/x')

    expect(await t.remoteHeads()).toEqual(['main'])
    expect(await t.localRemoteRefs()).not.toContain('origin/feature/x')
    expect(await t.localRemoteRefs()).toContain('origin/main')
    expect((await t.git('branch', '--format=%(refname:short)')).split('\n')).toContain('feature/x')
  })

  it('abre um único processo git', async () => {
    const t = await withRemote()
    const { onGitCommand } = await import('../src/core/exec')
    const started: string[][] = []
    const off = onGitCommand((entry) => {
      if (entry.exitCode === undefined) started.push(entry.args)
    })
    await t.repo.deleteRemoteBranch('origin', 'feature/x')
    off?.()
    expect(started).toHaveLength(1)
    expect(started[0]).toContain('push')
  })

  it('recusa nome de branch vazio, com "-" inicial, espaço ou NUL, sem tocar no remoto', async () => {
    const t = await withRemote()
    for (const name of ['', '-feature', '--all', 'feature x', 'feature\0x', 'feature\tx']) {
      await expect(t.repo.deleteRemoteBranch('origin', name)).rejects.toThrow()
    }
    expect(await t.remoteHeads()).toEqual(['feature/x', 'main'])
  })

  it('recusa nome de remoto vazio, com "-" inicial, espaço ou NUL, sem tocar no remoto', async () => {
    const t = await withRemote()
    for (const remote of ['', '-origin', '--mirror', 'ori gin', 'origin\0']) {
      await expect(t.repo.deleteRemoteBranch(remote, 'feature/x')).rejects.toThrow()
    }
    expect(await t.remoteHeads()).toEqual(['feature/x', 'main'])
  })

  it('lança erro quando o remoto não existe', async () => {
    const t = await withRemote()
    await expect(t.repo.deleteRemoteBranch('outro', 'feature/x')).rejects.toThrow()
    expect(await t.remoteHeads()).toEqual(['feature/x', 'main'])
  })

  it('lança erro quando a branch não existe no remoto', async () => {
    const t = await withRemote()
    await expect(t.repo.deleteRemoteBranch('origin', 'nao/existe')).rejects.toThrow()
    expect(await t.remoteHeads()).toEqual(['feature/x', 'main'])
  })
})
