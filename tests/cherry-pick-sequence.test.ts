import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { onGitCommand } from '../src/core/exec'
import { createRepo, type TestRepo } from './helpers'

const LINES = (v: (i: number) => string) => Array.from({ length: 6 }, (_, i) => v(i)).join('\n') + '\n'

/** `main` muda as linhas 0, 2 e 4; a `feature` tem três commits, cada um mudando uma delas: três paradas em sequência. */
async function threeStops(): Promise<{ t: TestRepo; shas: string[] }> {
  const t = await createRepo()
  // Datas de commit distintas: `orderCommits` ordena por data (`--no-walk=sorted`) e, em empate, segue a ordem recebida.
  let clock = 1_700_000_000
  const tick = () => (process.env.GIT_COMMITTER_DATE = `${++clock} +0000`)
  tick()
  await t.commit('base', { 'f.txt': LINES((i) => `base ${i}`) })
  await t.git('checkout', '-q', '-b', 'feature')
  const shas: string[] = []
  for (const n of [0, 2, 4]) {
    tick()
    shas.push(await t.commit(`feature ${n}`, { 'f.txt': LINES((i) => (i <= n && i % 2 === 0 ? `feature ${i}` : `base ${i}`)) }))
  }
  tick()
  await t.git('checkout', '-q', 'main')
  await t.commit('main muda', { 'f.txt': LINES((i) => (i % 2 === 0 ? `main ${i}` : `base ${i}`)) })
  return { t, shas }
}

const resolveWith = (t: TestRepo, text: string) => {
  t.write('f.txt', text)
  return t.git('add', 'f.txt')
}

afterAll(() => {
  delete process.env.GIT_COMMITTER_DATE
})

describe('cherry-pick de vários commits com conflitos em sequência', () => {
  it('para em cada commit, continua um a um e termina com o histórico esperado', async () => {
    const { t, shas } = await threeStops()
    const first = await t.repo.cherryPickCommits('main', shas)
    expect(first.ok).toBe(false)
    expect(first.conflicts).toEqual(['f.txt'])
    expect((await t.repo.operationState()).kind).toBe('cherry-pick')

    // Parada 1 -> 2 -> 3: cada `continue` aplica o commit resolvido e o git abre o conflito do seguinte.
    for (const n of [0, 2]) {
      await resolveWith(t, LINES((i) => `resolvido ${n} ${i}`))
      const step = await t.repo.continueOperation()
      expect(step.ok).toBe(false)
      expect(step.conflicts).toEqual(['f.txt'])
    }
    await resolveWith(t, LINES((i) => `final ${i}`))
    const last = await t.repo.continueOperation()
    expect(last).toMatchObject({ ok: true, conflicts: [] })

    expect((await t.repo.operationState()).kind).toBe('none')
    expect(readFileSync(join(t.dir, 'f.txt'), 'utf8')).toBe(LINES((i) => `final ${i}`))
    const log = (await t.git('log', '--format=%s', '-4')).trim().split('\n')
    expect(log).toEqual(['feature 4', 'feature 2', 'feature 0', 'main muda'])
  })

  it('cada parada gasta no máximo 3 processos git (status, continue, status do novo estado)', async () => {
    const { t, shas } = await threeStops()
    await t.repo.cherryPickCommits('main', shas)
    const counts: number[] = []
    for (let stop = 0; stop < 2; stop++) {
      await resolveWith(t, LINES((i) => `r${stop} ${i}`))
      let n = 0
      const off = onGitCommand((e) => {
        if (e.exitCode === undefined) n++
      })
      await t.repo.continueOperation()
      off()
      counts.push(n)
    }
    // Medido na E5 (#95): 3 processos por parada com conflito. O teto trava a catraca do fluxo atual.
    expect(Math.max(...counts)).toBeLessThanOrEqual(3)
  })
})
