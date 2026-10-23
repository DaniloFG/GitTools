// Dados dos dashboards (sem React nem DOM, para poder ser testado à parte): normaliza o que o git devolveu,
// identifica as pessoas e aplica os filtros da tela (período, autores, merges, bots).

import type { Analytics, AnalyticsCommit } from '../../../shared/types'

export const DAY = 86_400_000

/** Commit pronto para as métricas: o que veio do git mais os totais já somados. */
export interface Commit extends AnalyticsCommit {
  /** Identificador da pessoa (e-mail em minúsculas). */
  person: string
  /** Linhas adicionadas e removidas (arquivos binários não contam). */
  add: number
  del: number
  /** Quantidade de arquivos alterados. */
  nfiles: number
  merge: boolean
}

export interface Person {
  id: string
  /** Nome mais usado por essa pessoa nos commits. */
  name: string
  email: string
  commits: number
  /** Posição fixa na paleta: a cor acompanha a pessoa, não o ranking do filtro de agora. */
  slot: number
  bot: boolean
  first: number
  last: number
}

export interface Dataset {
  commits: Commit[]
  paths: string[]
  tree: { path: string; size: number }[]
  people: Person[]
  person: Map<string, Person>
  first: number
  last: number
  truncated: boolean
  generatedAt: number
}

const BOT = /(\[bot\]|^bot$|-bot$|^dependabot|^renovate|^github-actions|noreply\.github\.com$)/i

/** Nome ou e-mail de uma conta automática (Dependabot, Renovate, GitHub Actions…). */
export const isBot = (name: string, email: string) => BOT.test(name) || BOT.test(email)

export function buildDataset(data: Analytics): Dataset {
  const commits: Commit[] = []
  const names = new Map<string, Map<string, number>>()
  for (const c of data.commits) {
    const person = c.email.trim().toLowerCase() || c.author.trim().toLowerCase()
    let add = 0
    let del = 0
    for (const [, a, d] of c.files) {
      if (a > 0) add += a
      if (d > 0) del += d
    }
    commits.push({ ...c, person, add, del, nfiles: c.files.length, merge: c.parents > 1 })
    const byName = names.get(person) ?? new Map<string, number>()
    byName.set(c.author, (byName.get(c.author) ?? 0) + 1)
    names.set(person, byName)
  }
  commits.sort((a, b) => a.time - b.time)

  const people = new Map<string, Person>()
  for (const c of commits) {
    let p = people.get(c.person)
    if (!p) {
      const byName = names.get(c.person)!
      const name = [...byName.entries()].sort((a, b) => b[1] - a[1])[0][0]
      p = { id: c.person, name, email: c.email, commits: 0, slot: 0, bot: isBot(name, c.email), first: c.time, last: c.time }
      people.set(c.person, p)
    }
    p.commits++
    p.last = c.time
  }
  // A cor de cada pessoa vem da posição dela no ranking geral (quem tem mais commits fica com as primeiras cores).
  const ranked = [...people.values()].sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name))
  ranked.forEach((p, i) => (p.slot = i))
  return {
    commits,
    paths: data.paths,
    tree: data.tree,
    people: ranked,
    person: people,
    first: commits[0]?.time ?? 0,
    last: commits[commits.length - 1]?.time ?? 0,
    truncated: data.truncated,
    generatedAt: data.generatedAt
  }
}

export interface Filters {
  /** Início e fim do período em ms (null = sem limite). */
  from: number | null
  to: number | null
  /** Só estas pessoas (vazio = todas). */
  people: string[]
  includeMerges: boolean
  excludeBots: boolean
}

export const DEFAULT_FILTERS: Filters = { from: null, to: null, people: [], includeMerges: true, excludeBots: false }

export function applyFilters(ds: Dataset, f: Filters): Commit[] {
  const only = f.people.length ? new Set(f.people) : null
  return ds.commits.filter((c) => {
    if (f.from !== null && c.time < f.from) return false
    if (f.to !== null && c.time > f.to) return false
    if (only && !only.has(c.person)) return false
    if (!f.includeMerges && c.merge) return false
    if (f.excludeBots && ds.person.get(c.person)?.bot) return false
    return true
  })
}

export type PeriodId = '7d' | '30d' | '90d' | '6m' | '12m' | 'all' | 'custom'

export const PERIODS: PeriodId[] = ['7d', '30d', '90d', '6m', '12m', 'all']

const PERIOD_DAYS: Record<Exclude<PeriodId, 'all' | 'custom'>, number> = { '7d': 7, '30d': 30, '90d': 90, '6m': 182, '12m': 365 }

/**
 * Início do período, contado a partir do commit mais recente (e não de "hoje"): um repositório parado há
 * meses continua mostrando o último trecho de atividade em vez de uma tela vazia.
 */
export function periodRange(period: PeriodId, ds: Pick<Dataset, 'first' | 'last'>): { from: number | null; to: number | null } {
  if (period === 'all' || period === 'custom') return { from: null, to: null }
  const end = endOfDay(ds.last)
  return { from: startOfDay(end - PERIOD_DAYS[period] * DAY + 1), to: end }
}

export const startOfDay = (ms: number) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export const endOfDay = (ms: number) => {
  const d = new Date(ms)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}
