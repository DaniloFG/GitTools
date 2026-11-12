import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { onGitCommand } from '../src/core/exec'
import { createRepo, type TestRepo } from './helpers'

const LINES = (v: (i: number) => string) => Array.from({ length: 6 }, (_, i) => v(i)).join('\n') + '\n'

/** `main` muda as linhas 0, 2 e 4; a `feature` tem três commits, cada um mudando uma delas: três paradas em sequência. */
async function threeStops(): Promise<{ t: TestRepo; shas: string[] }> {
  const t = await createRepo()
  // Datas de commit distintas: `orderCommits` ordena por data (`--no-walk=sorted`) e só desempata pela ancestralidade
  // quando as datas são iguais. Aqui a ordem vem da data; o empate tem o seu `describe` mais abaixo.
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

/** Argumentos de cada processo git aberto enquanto `fn` roda. */
async function recordGit(fn: () => Promise<unknown>): Promise<string[][]> {
  const commands: string[][] = []
  const off = onGitCommand((e) => {
    if (e.exitCode === undefined) commands.push(e.args)
  })
  try {
    await fn()
  } finally {
    off()
  }
  return commands
}

/**
 * `main` com um commit-base e uma `feature` com `count` commits em cadeia, todos mudando o mesmo `f.txt`
 * (o commit N só se aplica depois do N-1). `sameDate` dá a todos a mesma data de committer.
 */
async function chain(count: number, sameDate: boolean): Promise<{ t: TestRepo; shas: string[] }> {
  const t = await createRepo()
  let clock = 1_700_000_000
  process.env.GIT_COMMITTER_DATE = `${clock} +0000`
  await t.commit('base', { 'base.txt': 'base\n' })
  await t.git('checkout', '-q', '-b', 'feature')
  const shas: string[] = []
  for (let i = 1; i <= count; i++) {
    process.env.GIT_COMMITTER_DATE = `${sameDate ? clock + 1 : ++clock} +0000`
    shas.push(await t.commit(`c${i}`, { 'f.txt': `v${i}\n` }))
  }
  await t.git('checkout', '-q', 'main')
  return { t, shas }
}

const subjects = async (t: TestRepo, n: number) => (await t.git('log', '--format=%s', `-${n}`)).trim().split('\n').reverse()

/** Processos de `cherryPickCommits` com datas distintas, medidos antes da correção (um deles é o rev-list de `orderCommits`). */
const PROCESSOS_ANTES = 3

describe('ordem dos commits com a mesma data de committer', () => {
  it('commits em cadeia criados no mesmo segundo, em ordem embaralhada, são aplicados pai antes do filho', async () => {
    const { t, shas } = await chain(3, true)
    const [c1, c2, c3] = shas
    const result = await t.repo.cherryPickCommits('main', [c3, c1, c2])
    expect(result).toMatchObject({ ok: true, conflicts: [] })
    expect(await subjects(t, 3)).toEqual(['c1', 'c2', 'c3'])
    expect(readFileSync(join(t.dir, 'f.txt'), 'utf8')).toBe('v3\n')
  })

  it('com um commit do meio fora da seleção, a ancestralidade (não só o pai direto) decide a ordem', async () => {
    const t = await createRepo()
    process.env.GIT_COMMITTER_DATE = '1700000000 +0000'
    await t.commit('base', { 'base.txt': 'base\n' })
    await t.git('checkout', '-q', '-b', 'feature')
    process.env.GIT_COMMITTER_DATE = '1700000001 +0000'
    const c1 = await t.commit('c1', { 'a.txt': '1\n' })
    await t.commit('c2', { 'b.txt': '2\n' })
    const c3 = await t.commit('c3', { 'a.txt': '3\n' })
    await t.git('checkout', '-q', 'main')
    // A recebida [c1, c3] seria invertida para [c3, c1] (c3 mudaria um a.txt que ainda não existe).
    const commands = await recordGit(async () => {
      expect(await t.repo.cherryPickCommits('main', [c1, c3])).toMatchObject({ ok: true, conflicts: [] })
    })
    expect(await subjects(t, 2)).toEqual(['c1', 'c3'])
    // Par sem pai direto: uma consulta basta quando o primeiro palpite acerta.
    expect(commands.filter((a) => a.includes('merge-base')).length).toBeGreaterThan(0)
  })

  it('empate entre commits sem relação de ancestralidade (ramos) não quebra', async () => {
    const t = await createRepo()
    process.env.GIT_COMMITTER_DATE = '1700000000 +0000'
    await t.commit('base', { 'base.txt': 'base\n' })
    process.env.GIT_COMMITTER_DATE = '1700000001 +0000'
    await t.git('checkout', '-q', '-b', 'x')
    const x = await t.commit('x', { 'x.txt': 'x\n' })
    await t.git('checkout', '-q', 'main')
    await t.git('checkout', '-q', '-b', 'y')
    const y = await t.commit('y', { 'y.txt': 'y\n' })
    await t.git('checkout', '-q', 'main')
    const result = await t.repo.cherryPickCommits('main', [y, x])
    expect(result).toMatchObject({ ok: true, conflicts: [] })
    // Sem relação, vale a ordem de antes: a recebida, invertida pelo `.reverse()`.
    expect(await subjects(t, 2)).toEqual(['x', 'y'])
    expect(readFileSync(join(t.dir, 'x.txt'), 'utf8')).toBe('x\n')
    expect(readFileSync(join(t.dir, 'y.txt'), 'utf8')).toBe('y\n')
  })

  it('grupo empatado com mais de 20 commits: ordena pelos pais diretos e não consulta merge-base (teto de processos)', async () => {
    const { t, shas } = await chain(21, true)
    // Ordem embaralhada de forma fixa (posições ímpares e depois pares): a inversão da ordem recebida não a conserta.
    const shuffled = [...shas.filter((_, i) => i % 2 === 1), ...shas.filter((_, i) => i % 2 === 0)]
    let result: unknown
    const commands = await recordGit(async () => {
      result = await t.repo.cherryPickCommits('main', shuffled)
    })
    expect(result).toMatchObject({ ok: true, conflicts: [] })
    expect(await subjects(t, 21)).toEqual(Array.from({ length: 21 }, (_, i) => `c${i + 1}`))
    expect(commands.filter((a) => a.includes('merge-base'))).toEqual([])
  })

  it('datas distintas: ordem e número de processos iguais aos de antes (nenhum merge-base)', async () => {
    const { t, shas } = await chain(3, false)
    const [c1, c2, c3] = shas
    const commands = await recordGit(() => t.repo.cherryPickCommits('main', [c2, c3, c1]))
    expect(await subjects(t, 3)).toEqual(['c1', 'c2', 'c3'])
    expect(commands.filter((a) => a.includes('merge-base'))).toEqual([])
    expect(commands.filter((a) => a[0] === 'rev-list')).toHaveLength(1)
    expect(commands).toHaveLength(PROCESSOS_ANTES)
  })

  it('empate com pai direto resolve sem abrir processo extra', async () => {
    const { t, shas } = await chain(3, true)
    const [c1, c2, c3] = shas
    const commands = await recordGit(() => t.repo.cherryPickCommits('main', [c3, c1, c2]))
    expect(commands.filter((a) => a.includes('merge-base'))).toEqual([])
  })
})
