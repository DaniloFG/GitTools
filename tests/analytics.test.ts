import { describe, expect, it } from 'vitest'
import type { Analytics, AnalyticsCommit } from '../src/shared/types'
import { applyFilters, buildDataset, DEFAULT_FILTERS, periodRange } from '../src/renderer/src/analytics/model'
import {
  auditFlags,
  auditSummary,
  autoGranularity,
  bucketStart,
  busFactor,
  byFile,
  byPerson,
  coChange,
  commandRows,
  cumulative,
  extensionOf,
  folderTree,
  histogram,
  kindOf,
  kpis,
  median,
  newcomers,
  overTime,
  overTimeByPerson,
  percentile,
  releases,
  SIZE_EDGES,
  streaks,
  weekdayHour
} from '../src/renderer/src/analytics/metrics'

/** Data no horário local (os agrupamentos por dia e hora também são no horário local). */
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0).getTime()

let n = 0
function commit(over: Partial<AnalyticsCommit> & { files?: [number, number, number][] }): AnalyticsCommit {
  n++
  return {
    sha: String(n).padStart(40, '0'),
    parents: 1,
    author: 'Ana',
    email: 'ana@x.com',
    committer: 'Ana',
    committerEmail: 'ana@x.com',
    time: at(2026, 1, 5),
    commitTime: at(2026, 1, 5),
    subject: 'feat: algo',
    bodyLength: 20,
    signedOff: false,
    coAuthors: 0,
    tags: [],
    files: [],
    ...over
  }
}

const data = (commits: AnalyticsCommit[], paths = ['a.ts', 'b.ts', 'src/ui/c.tsx', 'README.md']): Analytics => ({ scope: 'all', commits, paths, truncated: false, tree: [], generatedAt: 0 })

describe('conjunto de dados', () => {
  it('junta variações do nome pelo e-mail, ordena por data e soma linhas (binário não conta)', () => {
    const ds = buildDataset(
      data([
        commit({ author: 'Ana C.', email: 'ANA@x.com', time: at(2026, 1, 9), files: [[0, 5, 2], [1, -1, -1]] }),
        commit({ author: 'Ana Costa', email: 'ana@x.com', time: at(2026, 1, 3), files: [[0, 1, 0]] }),
        commit({ author: 'Ana Costa', email: 'ana@x.com', time: at(2026, 1, 4) }),
        commit({ author: 'Bia', email: 'bia@x.com', time: at(2026, 1, 5), parents: 2 })
      ])
    )
    expect(ds.commits.map((c) => c.time)).toEqual([at(2026, 1, 3), at(2026, 1, 4), at(2026, 1, 5), at(2026, 1, 9)])
    expect(ds.people.map((p) => [p.name, p.commits, p.slot])).toEqual([['Ana Costa', 3, 0], ['Bia', 1, 1]])
    const big = ds.commits[3]
    expect([big.add, big.del, big.nfiles, big.merge]).toEqual([5, 2, 2, false])
    expect(ds.commits[2].merge).toBe(true)
    expect(ds.first).toBe(at(2026, 1, 3))
    expect(ds.last).toBe(at(2026, 1, 9))
  })

  it('reconhece contas automáticas e aplica os filtros', () => {
    const ds = buildDataset(
      data([
        commit({ author: 'dependabot[bot]', email: 'bot@x.com', time: at(2026, 1, 2) }),
        commit({ time: at(2026, 1, 10) }),
        commit({ time: at(2026, 1, 20), parents: 2 }),
        commit({ author: 'Bia', email: 'bia@x.com', time: at(2026, 2, 1) })
      ])
    )
    expect(ds.person.get('bot@x.com')?.bot).toBe(true)
    expect(applyFilters(ds, DEFAULT_FILTERS)).toHaveLength(4)
    expect(applyFilters(ds, { ...DEFAULT_FILTERS, excludeBots: true })).toHaveLength(3)
    expect(applyFilters(ds, { ...DEFAULT_FILTERS, includeMerges: false })).toHaveLength(3)
    expect(applyFilters(ds, { ...DEFAULT_FILTERS, people: ['bia@x.com'] })).toHaveLength(1)
    expect(applyFilters(ds, { ...DEFAULT_FILTERS, from: at(2026, 1, 5), to: at(2026, 1, 25) })).toHaveLength(2)
  })

  it('o período conta a partir do último commit, não de hoje', () => {
    const ds = { first: at(2025, 1, 1), last: at(2026, 3, 10, 15) }
    const r = periodRange('30d', ds)
    expect(new Date(r.to!).getDate()).toBe(10)
    expect(Math.round((r.to! - r.from!) / 86_400_000)).toBe(30)
    expect(periodRange('all', ds)).toEqual({ from: null, to: null })
  })
})

describe('tempo', () => {
  it('baldes de dia, semana (segunda) e mês', () => {
    expect(bucketStart(at(2026, 1, 7, 15), 'day')).toBe(at(2026, 1, 7, 0))
    expect(bucketStart(at(2026, 1, 7, 15), 'week')).toBe(at(2026, 1, 5, 0)) // 7/1/2026 é quarta
    expect(bucketStart(at(2026, 1, 11, 15), 'week')).toBe(at(2026, 1, 5, 0)) // domingo ainda é da semana de segunda
    expect(bucketStart(at(2026, 3, 31, 23), 'month')).toBe(at(2026, 3, 1, 0))
    expect(autoGranularity(at(2026, 1, 1), at(2026, 1, 20))).toBe('day')
    expect(autoGranularity(at(2026, 1, 1), at(2026, 9, 1))).toBe('week')
    expect(autoGranularity(at(2024, 1, 1), at(2026, 9, 1))).toBe('month')
  })

  it('soma por balde incluindo os vazios, e acumula', () => {
    const ds = buildDataset(data([commit({ time: at(2026, 1, 5) }), commit({ time: at(2026, 1, 5, 18) }), commit({ time: at(2026, 1, 8) })]))
    const s = overTime(ds.commits, 'day', at(2026, 1, 5), at(2026, 1, 9))
    expect(s.y).toEqual([2, 0, 0, 1, 0])
    expect(cumulative(s.y)).toEqual([2, 2, 2, 3, 3])
  })

  it('séries por pessoa: as principais e o resto como "outras"', () => {
    const ds = buildDataset(
      data([commit({ time: at(2026, 1, 5) }), commit({ email: 'b@x.com', author: 'B', time: at(2026, 1, 5) }), commit({ email: 'c@x.com', author: 'C', time: at(2026, 1, 6) })])
    )
    const r = overTimeByPerson(ds.commits, 'day', at(2026, 1, 5), at(2026, 1, 6), ['ana@x.com'])
    expect(r.series.map((s) => [s.id, s.y])).toEqual([['ana@x.com', [1, 0]], ['__others__', [1, 1]]])
  })

  it('matriz de dia da semana por hora e sequências de dias', () => {
    const ds = buildDataset(data([commit({ time: at(2026, 1, 5, 9) }), commit({ time: at(2026, 1, 5, 9) }), commit({ time: at(2026, 1, 11, 23) })]))
    const m = weekdayHour(ds.commits)
    expect(m[0][9]).toBe(2) // segunda, 9h
    expect(m[6][23]).toBe(1) // domingo, 23h
    const s = streaks(buildDataset(data([5, 6, 7, 12, 13].map((d) => commit({ time: at(2026, 1, d) })))).commits)
    expect(s).toEqual({ activeDays: 5, currentStreak: 2, longestStreak: 3, longestGap: 4 })
  })
})

describe('pessoas e arquivos', () => {
  it('resume por pessoa, calcula o fator de ônibus e os novos contribuintes', () => {
    const cs = [
      commit({ time: at(2026, 1, 5), files: [[0, 10, 0]] }),
      commit({ time: at(2026, 1, 6), files: [[0, 2, 1], [1, 3, 0]] }),
      commit({ email: 'b@x.com', author: 'B', time: at(2026, 2, 3), files: [[1, 1, 1]] }),
      commit({ time: at(2026, 2, 4) })
    ]
    const ds = buildDataset(data(cs))
    const rows = byPerson(ds.commits)
    expect(rows[0]).toMatchObject({ id: 'ana@x.com', commits: 3, add: 15, del: 1, files: 2, activeDays: 3 })
    expect(busFactor([80, 15, 5])).toBe(1)
    expect(busFactor([30, 30, 20, 20])).toBe(2)
    expect(busFactor([])).toBe(0)
    const nc = newcomers(ds, ds.commits, at(2026, 1, 1), at(2026, 2, 28))
    expect(nc.added).toEqual([1, 1]) // Ana em janeiro, B em fevereiro
    expect(nc.returning).toEqual([0, 1]) // Ana volta em fevereiro
  })

  it('arquivos mais mexidos, acoplamento e árvore de pastas', () => {
    const paths = ['src/a.ts', 'src/b.ts', 'src/ui/c.tsx', 'README.md']
    const cs = [
      commit({ files: [[0, 5, 1], [1, 2, 0]] }),
      commit({ files: [[0, 1, 1], [1, 1, 1], [3, 1, 0]] }),
      commit({ email: 'b@x.com', author: 'B', files: [[0, 1, 0]] }),
      commit({ files: [[2, 9, 0]] })
    ]
    const ds = buildDataset(data(cs, paths))
    const files = byFile(ds.commits, paths)
    expect(files[0]).toMatchObject({ path: 'src/a.ts', commits: 3, add: 7, del: 2, people: 2 })
    expect(coChange(ds.commits, paths)).toEqual([{ a: 'src/a.ts', b: 'src/b.ts', count: 2 }])
    const tree = folderTree(files.map((f) => ({ path: f.path, value: f.add + f.del })))
    expect(tree.value).toBe(files.reduce((s, f) => s + f.add + f.del, 0))
    expect(tree.children!.map((c) => c.name)).toEqual(['src', 'README.md'])
    expect(extensionOf('src/a.test.ts')).toBe('ts')
    expect(extensionOf('Makefile')).toBe('(sem extensão)')
    expect(extensionOf('.gitignore')).toBe('.gitignore')
  })

  it('histograma por faixas de tamanho', () => {
    const bins = histogram([0, 5, 11, 60, 2000], SIZE_EDGES, (a, b) => (b === null ? `${a}+` : `${a}–${b}`))
    expect(bins.map((b) => [b.label, b.count])).toEqual([['0–10', 2], ['11–50', 1], ['51–200', 1], ['201–500', 0], ['501–1000', 0], ['1001+', 1]])
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9)
  })
})

describe('mensagens e auditoria', () => {
  it('classifica o tipo do commit (Conventional Commits e palavras comuns)', () => {
    const k = (subject: string, merge = false) => kindOf({ subject, merge })
    expect(k('feat(ui): botão')).toEqual({ kind: 'feat', conventional: true })
    expect(k('fix!: quebra')).toEqual({ kind: 'fix', conventional: true })
    expect(k('Tests: cobre o login').kind).toBe('test')
    expect(k('Merge pull request #3 from a/b')).toEqual({ kind: 'merge', conventional: false })
    expect(k('anything', true).kind).toBe('merge')
    expect(k('Corrige o filtro de datas')).toEqual({ kind: 'fix', conventional: false })
    expect(k('Adiciona login')).toEqual({ kind: 'feat', conventional: false })
    expect(k('Revert "feat: x"').kind).toBe('revert')
    expect(k('mudanças gerais').kind).toBe('other')
  })

  it('sinaliza mensagens fracas, fora do horário, commits grandes e outro committer', () => {
    const base = buildDataset(data([commit({})])).commits[0]
    expect(auditFlags(base)).toEqual(['noSignoff'])
    const flags = (over: Partial<typeof base>) => auditFlags({ ...base, ...over })
    expect(flags({ subject: 'wip', bodyLength: 0 })).toEqual(expect.arrayContaining(['weakSubject', 'noBody', 'notConventional']))
    expect(flags({ time: at(2026, 1, 5, 23) })).toContain('offHours')
    expect(flags({ time: at(2026, 1, 10, 10) })).toContain('weekend')
    expect(flags({ add: 900, del: 200 })).toContain('large')
    expect(flags({ committerEmail: 'ci@x.com' })).toContain('otherCommitter')
    expect(flags({ signedOff: true })).not.toContain('noSignoff')
    expect(flags({ subject: 'x'.repeat(80) })).toContain('longSubject')
    const summary = auditSummary([base, { ...base, subject: 'wip' }])
    expect(summary.total).toBe(2)
    expect(summary.counts.weakSubject).toBe(1)
    expect(summary.clean).toBe(1)
  })
})

describe('resumo, releases e comandos', () => {
  it('KPIs e releases', () => {
    const ds = buildDataset(
      data([
        commit({ time: at(2026, 1, 5), files: [[0, 10, 2]], tags: ['v1'] }),
        commit({ email: 'b@x.com', author: 'B', time: at(2026, 1, 5, 18), files: [[0, 1, 0], [1, 4, 4]] }),
        commit({ time: at(2026, 1, 15), parents: 2, tags: ['v2'] })
      ])
    )
    const k = kpis(ds.commits)
    expect(k).toMatchObject({ commits: 3, people: 2, activeDays: 2, additions: 15, deletions: 6, filesTouched: 2, merges: 1 })
    expect(k.perActiveDay).toBe(1.5)
    expect(releases(ds.commits)).toEqual([
      { tag: 'v1', time: at(2026, 1, 5), sinceLast: null },
      { tag: 'v2', time: at(2026, 1, 15), sinceLast: 10 }
    ])
  })

  it('comandos do git: contagem, falhas e duração por subcomando', () => {
    const rows = commandRows([
      { args: ['log', '--all'], durationMs: 10 },
      { args: ['log'], durationMs: 30, failed: true },
      { args: ['-c', 'x=y', 'commit', '-m', 'm'], durationMs: 100 },
      { args: ['status'] }
    ])
    expect(rows.map((r) => [r.command, r.runs, r.failed, r.avgMs, r.maxMs, r.readOnly])).toEqual([
      ['log', 2, 1, 20, 30, true],
      ['x=y', 1, 0, 100, 100, false]
    ])
  })
})
