// Métricas dos dashboards (funções puras sobre a lista de commits já filtrada).

import type { Commit, Dataset } from './model'
import { DAY, startOfDay } from './model'

// ------------------------------------------------------------------------------------------ utilidades

export function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]
}

export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

/** Linhas alteradas pelo commit (adicionadas + removidas). */
export const churn = (c: Commit) => c.add + c.del

// ------------------------------------------------------------------------------------------ tempo

export type Granularity = 'day' | 'week' | 'month'

/** Início do balde (dia, semana começando na segunda ou mês) em que `ms` cai, no horário local. */
export function bucketStart(ms: number, g: Granularity): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  if (g === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  else if (g === 'month') d.setDate(1)
  return d.getTime()
}

export function nextBucket(ms: number, g: Granularity): number {
  const d = new Date(ms)
  if (g === 'day') d.setDate(d.getDate() + 1)
  else if (g === 'week') d.setDate(d.getDate() + 7)
  else d.setMonth(d.getMonth() + 1)
  return d.getTime()
}

/** Granularidade que deixa o gráfico com um número agradável de pontos. */
export function autoGranularity(from: number, to: number): Granularity {
  const days = Math.max(1, (to - from) / DAY)
  return days <= 75 ? 'day' : days <= 540 ? 'week' : 'month'
}

/** Todos os baldes do período, inclusive os vazios (para o gráfico não "pular" semanas sem commits). */
export function bucketsBetween(from: number, to: number, g: Granularity): number[] {
  const out: number[] = []
  for (let t = bucketStart(from, g); t <= to; t = nextBucket(t, g)) out.push(t)
  return out
}

export interface TimeSeries {
  x: number[]
  y: number[]
}

/** Soma `value(commit)` por balde de tempo. */
export function overTime(cs: Commit[], g: Granularity, from: number, to: number, value: (c: Commit) => number = () => 1): TimeSeries {
  const x = bucketsBetween(from, to, g)
  const index = new Map(x.map((t, i) => [t, i]))
  const y = new Array<number>(x.length).fill(0)
  for (const c of cs) {
    const i = index.get(bucketStart(c.time, g))
    if (i !== undefined) y[i] += value(c)
  }
  return { x, y }
}

export const cumulative = (values: number[]) => {
  let total = 0
  return values.map((v) => (total += v))
}

/** Séries por pessoa (as `top` maiores; o resto vira "outras") para gráficos empilhados. */
export function overTimeByPerson(cs: Commit[], g: Granularity, from: number, to: number, top: string[], value: (c: Commit) => number = () => 1) {
  const x = bucketsBetween(from, to, g)
  const index = new Map(x.map((t, i) => [t, i]))
  const rows = new Map<string, number[]>()
  for (const id of [...top, OTHERS]) rows.set(id, new Array<number>(x.length).fill(0))
  const known = new Set(top)
  for (const c of cs) {
    const i = index.get(bucketStart(c.time, g))
    if (i === undefined) continue
    rows.get(known.has(c.person) ? c.person : OTHERS)![i] += value(c)
  }
  return { x, series: [...rows.entries()].filter(([id, y]) => id !== OTHERS || y.some(Boolean)).map(([id, y]) => ({ id, y })) }
}

export const OTHERS = '__others__'

/** Matriz dia da semana (segunda = 0) × hora do dia (0–23). */
export function weekdayHour(cs: Commit[]): number[][] {
  const m = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  for (const c of cs) {
    const d = new Date(c.time)
    m[(d.getDay() + 6) % 7][d.getHours()]++
  }
  return m
}

/** Commits por dia (chave = início do dia em ms). */
export function perDay(cs: Commit[]): Map<number, number> {
  const out = new Map<number, number>()
  for (const c of cs) {
    const day = startOfDay(c.time)
    out.set(day, (out.get(day) ?? 0) + 1)
  }
  return out
}

export interface Streaks {
  activeDays: number
  currentStreak: number
  longestStreak: number
  /** Maior intervalo (em dias) sem nenhum commit dentro do período. */
  longestGap: number
}

export function streaks(cs: Commit[]): Streaks {
  const days = [...perDay(cs).keys()].sort((a, b) => a - b)
  let longest = 0
  let run = 0
  let gap = 0
  for (let i = 0; i < days.length; i++) {
    const step = i ? Math.round((days[i] - days[i - 1]) / DAY) : 1
    run = step === 1 ? run + 1 : 1
    if (i && step > 1) gap = Math.max(gap, step - 1)
    longest = Math.max(longest, run)
  }
  return { activeDays: days.length, currentStreak: days.length ? run : 0, longestStreak: longest, longestGap: gap }
}

// ------------------------------------------------------------------------------------------ pessoas

export interface PersonRow {
  id: string
  commits: number
  add: number
  del: number
  files: number
  activeDays: number
  first: number
  last: number
}

export function byPerson(cs: Commit[]): PersonRow[] {
  const rows = new Map<string, PersonRow & { fileSet: Set<number>; days: Set<number> }>()
  for (const c of cs) {
    let r = rows.get(c.person)
    if (!r) {
      r = { id: c.person, commits: 0, add: 0, del: 0, files: 0, activeDays: 0, first: c.time, last: c.time, fileSet: new Set(), days: new Set() }
      rows.set(c.person, r)
    }
    r.commits++
    r.add += c.add
    r.del += c.del
    r.first = Math.min(r.first, c.time)
    r.last = Math.max(r.last, c.time)
    r.days.add(startOfDay(c.time))
    for (const [p] of c.files) r.fileSet.add(p)
  }
  return [...rows.values()]
    .map(({ fileSet, days, ...r }) => ({ ...r, files: fileSet.size, activeDays: days.size }))
    .sort((a, b) => b.commits - a.commits)
}

/** Quantas pessoas, no mínimo, respondem por `share` (0–1) do total (fator de ônibus: 1 = tudo depende de uma pessoa). */
export function busFactor(values: number[], share = 0.5): number {
  const total = sum(values)
  if (!total) return 0
  let acc = 0
  let n = 0
  for (const v of [...values].sort((a, b) => b - a)) {
    acc += v
    n++
    if (acc / total >= share) break
  }
  return n
}

/** Pessoas que fizeram o primeiro commit do repositório em cada mês, e quantas voltaram a contribuir. */
export function newcomers(ds: Dataset, cs: Commit[], from: number, to: number): { x: number[]; added: number[]; returning: number[] } {
  const x = bucketsBetween(from, to, 'month')
  const index = new Map(x.map((t, i) => [t, i]))
  const added = new Array<number>(x.length).fill(0)
  const returning = new Array<number>(x.length).fill(0)
  const seen = new Set<string>()
  for (const c of cs) {
    const i = index.get(bucketStart(c.time, 'month'))
    if (i === undefined) continue
    const key = `${c.person}|${i}`
    if (seen.has(key)) continue
    seen.add(key)
    if (bucketStart(ds.person.get(c.person)?.first ?? c.time, 'month') === x[i]) added[i]++
    else returning[i]++
  }
  return { x, added, returning }
}

// ------------------------------------------------------------------------------------------ arquivos

export interface FileRow {
  path: string
  commits: number
  add: number
  del: number
  people: number
  first: number
  last: number
}

export function byFile(cs: Commit[], paths: string[]): FileRow[] {
  const rows = new Map<number, FileRow & { who: Set<string> }>()
  for (const c of cs) {
    for (const [p, a, d] of c.files) {
      let r = rows.get(p)
      if (!r) {
        r = { path: paths[p], commits: 0, add: 0, del: 0, people: 0, first: c.time, last: c.time, who: new Set() }
        rows.set(p, r)
      }
      r.commits++
      if (a > 0) r.add += a
      if (d > 0) r.del += d
      r.who.add(c.person)
      r.first = Math.min(r.first, c.time)
      r.last = Math.max(r.last, c.time)
    }
  }
  return [...rows.values()].map(({ who, ...r }) => ({ ...r, people: who.size })).sort((a, b) => b.commits - a.commits)
}

export interface TreeNode {
  name: string
  path: string
  value: number
  children?: TreeNode[]
}

/** Árvore de pastas com `value(file)` somado em cada pasta (para o treemap). */
export function folderTree(files: { path: string; value: number }[], rootName = '/'): TreeNode {
  const root: TreeNode = { name: rootName, path: '', value: 0, children: [] }
  for (const f of files) {
    if (f.value <= 0) continue
    let node = root
    node.value += f.value
    const parts = f.path.split('/')
    parts.forEach((part, i) => {
      node.children ??= []
      const leaf = i === parts.length - 1
      let next = node.children.find((c) => c.name === part && !!c.children === !leaf)
      if (!next) {
        next = { name: part, path: parts.slice(0, i + 1).join('/'), value: 0, ...(leaf ? {} : { children: [] }) }
        node.children.push(next)
      }
      next.value += f.value
      node = next
    })
  }
  return collapse(root)
}

/** Pastas com um só filho viram um nome só ("src/app/ui"). */
function collapse(node: TreeNode): TreeNode {
  if (!node.children) return node
  node.children = node.children.map(collapse).sort((a, b) => b.value - a.value)
  let current = node
  while (current.children?.length === 1 && current.children[0].children) {
    const only = current.children[0]
    current = { ...only, name: current.name === '/' || !current.name ? only.name : `${current.name}/${only.name}` }
  }
  return current
}

export const extensionOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : base.startsWith('.') ? base : '(sem extensão)'
}

export function topFolder(path: string, depth = 1): string {
  const parts = path.split('/')
  return parts.length <= depth ? '/' : parts.slice(0, depth).join('/')
}

/** Pares de arquivos que mudam juntos com frequência (acoplamento oculto). */
export function coChange(cs: Commit[], paths: string[], limit = 12): { a: string; b: string; count: number }[] {
  const MAX_FILES = 25
  const pairs = new Map<string, number>()
  for (const c of cs) {
    if (c.files.length < 2 || c.files.length > MAX_FILES) continue
    const ids = c.files.map((f) => f[0]).sort((a, b) => a - b)
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.set(`${ids[i]}|${ids[j]}`, (pairs.get(`${ids[i]}|${ids[j]}`) ?? 0) + 1)
  }
  return [...pairs.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, count]) => {
      const [a, b] = k.split('|').map(Number)
      return { a: paths[a], b: paths[b], count }
    })
}

// ------------------------------------------------------------------------------------------ tamanho

export interface Bin {
  label: string
  /** Limite inferior do intervalo (inclusive). */
  min: number
  count: number
}

export function histogram(values: number[], edges: number[], label: (min: number, max: number | null) => string): Bin[] {
  const bins: Bin[] = edges.map((min, i) => ({ label: label(min, edges[i + 1] === undefined ? null : edges[i + 1] - 1), min, count: 0 }))
  for (const v of values) {
    let i = edges.length - 1
    while (i > 0 && v < edges[i]) i--
    bins[i].count++
  }
  return bins
}

export const SIZE_EDGES = [0, 11, 51, 201, 501, 1001]
export const FILES_EDGES = [1, 2, 4, 8, 16, 31]

// ------------------------------------------------------------------------------------------ mensagens

export type CommitKind = 'feat' | 'fix' | 'docs' | 'refactor' | 'test' | 'perf' | 'build' | 'chore' | 'style' | 'revert' | 'merge' | 'other'

export const KINDS: CommitKind[] = ['feat', 'fix', 'refactor', 'docs', 'test', 'perf', 'build', 'chore', 'style', 'revert', 'merge', 'other']

const CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|tests|build|ci|chore|revert)(\([^)]*\))?!?:\s/i

/** Tipo do commit pelo título: Conventional Commits primeiro, depois palavras comuns (em inglês e português). */
export function kindOf(c: Pick<Commit, 'subject' | 'merge'>): { kind: CommitKind; conventional: boolean } {
  const s = c.subject.trim()
  if (c.merge || /^merge\b/i.test(s)) return { kind: 'merge', conventional: false }
  const m = CONVENTIONAL.exec(s)
  if (m) {
    const k = m[1].toLowerCase()
    const kind: CommitKind = k === 'tests' ? 'test' : k === 'ci' ? 'build' : (k as CommitKind)
    return { kind, conventional: true }
  }
  if (/^revert\b|^reverte\b/i.test(s)) return { kind: 'revert', conventional: false }
  if (/\b(fix|fixes|fixed|bug|hotfix|corrige|corrigir|ajusta|conserta)\b/i.test(s)) return { kind: 'fix', conventional: false }
  if (/^(add|adds|added|implement|create|adiciona|adicionar|implementa|cria|novo|nova)\b/i.test(s)) return { kind: 'feat', conventional: false }
  if (/\b(refactor|refatora|cleanup|limpa|rename|renomeia)\b/i.test(s)) return { kind: 'refactor', conventional: false }
  if (/\b(doc|docs|readme|documenta)/i.test(s)) return { kind: 'docs', conventional: false }
  if (/\b(test|tests|teste|testes)\b/i.test(s)) return { kind: 'test', conventional: false }
  return { kind: 'other', conventional: false }
}

export function kindCounts(cs: Commit[]): { kind: CommitKind; count: number }[] {
  const counts = new Map<CommitKind, number>()
  for (const c of cs) {
    const { kind } = kindOf(c)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return KINDS.map((kind) => ({ kind, count: counts.get(kind) ?? 0 })).filter((r) => r.count > 0)
}

// ------------------------------------------------------------------------------------------ auditoria

export type AuditFlag = 'noBody' | 'weakSubject' | 'longSubject' | 'notConventional' | 'offHours' | 'weekend' | 'large' | 'otherCommitter' | 'revert' | 'noSignoff'

export const AUDIT_FLAGS: AuditFlag[] = ['noBody', 'weakSubject', 'longSubject', 'notConventional', 'offHours', 'weekend', 'large', 'otherCommitter', 'revert', 'noSignoff']

/** Expediente padrão para "fora do horário": antes das 7h ou a partir das 20h. */
export const WORK_HOURS = { start: 7, end: 20 }

const WEAK = /^(wip|tmp|temp|test|testing|asdf+|fix|fixes|update|updates|changes?|ajustes?|teste|\.+|-+|misc|stuff|minor|final|ok)\.?$/i
const FIXUP = /^(fixup|squash|amend)!/i

export function auditFlags(c: Commit): AuditFlag[] {
  const flags: AuditFlag[] = []
  const subject = c.subject.trim()
  const { conventional, kind } = kindOf(c)
  if (!c.merge && c.bodyLength === 0) flags.push('noBody')
  if (WEAK.test(subject) || FIXUP.test(subject) || /\bwip\b/i.test(subject) || subject.length < 8) flags.push('weakSubject')
  if (subject.length > 72) flags.push('longSubject')
  if (!c.merge && !conventional) flags.push('notConventional')
  const d = new Date(c.time)
  const hour = d.getHours()
  if (hour < WORK_HOURS.start || hour >= WORK_HOURS.end) flags.push('offHours')
  if (d.getDay() === 0 || d.getDay() === 6) flags.push('weekend')
  if (churn(c) > 1000 || c.nfiles > 50) flags.push('large')
  if (c.committerEmail.trim().toLowerCase() !== c.email.trim().toLowerCase()) flags.push('otherCommitter')
  if (kind === 'revert') flags.push('revert')
  if (!c.merge && !c.signedOff) flags.push('noSignoff')
  return flags
}

export interface AuditSummary {
  total: number
  counts: Record<AuditFlag, number>
  /** Commits sem nenhuma sinalização "séria" (mensagem fraca, grande, revert ou outro committer). */
  clean: number
}

const SERIOUS: AuditFlag[] = ['weakSubject', 'large', 'revert', 'otherCommitter', 'noBody']

export function auditSummary(cs: Commit[]): AuditSummary {
  const counts = Object.fromEntries(AUDIT_FLAGS.map((f) => [f, 0])) as Record<AuditFlag, number>
  let clean = 0
  for (const c of cs) {
    const flags = auditFlags(c)
    for (const f of flags) counts[f]++
    if (!flags.some((f) => SERIOUS.includes(f))) clean++
  }
  return { total: cs.length, counts, clean }
}

/** Commits que merecem olhar: os mais recentes com alguma sinalização séria, com o motivo. */
export function flaggedCommits(cs: Commit[], limit = 50): { commit: Commit; flags: AuditFlag[] }[] {
  const out: { commit: Commit; flags: AuditFlag[] }[] = []
  for (let i = cs.length - 1; i >= 0 && out.length < limit; i--) {
    const flags = auditFlags(cs[i]).filter((f) => SERIOUS.includes(f) || f === 'longSubject')
    if (flags.length) out.push({ commit: cs[i], flags })
  }
  return out
}

// ------------------------------------------------------------------------------------------ resumo

export interface Kpis {
  commits: number
  people: number
  activeDays: number
  additions: number
  deletions: number
  filesTouched: number
  merges: number
  perActiveDay: number
  medianLines: number
  medianFiles: number
}

export function kpis(cs: Commit[]): Kpis {
  const people = new Set<string>()
  const files = new Set<number>()
  const days = new Set<number>()
  let add = 0
  let del = 0
  let merges = 0
  for (const c of cs) {
    people.add(c.person)
    days.add(startOfDay(c.time))
    add += c.add
    del += c.del
    if (c.merge) merges++
    for (const [p] of c.files) files.add(p)
  }
  const real = cs.filter((c) => !c.merge)
  return {
    commits: cs.length,
    people: people.size,
    activeDays: days.size,
    additions: add,
    deletions: del,
    filesTouched: files.size,
    merges,
    perActiveDay: days.size ? cs.length / days.size : 0,
    medianLines: median(real.map(churn)),
    medianFiles: median(real.map((c) => c.nfiles))
  }
}

// ------------------------------------------------------------------------------------------ releases

/** Tags e a data do commit a que apontam (da mais antiga para a mais nova). */
export function releases(cs: Commit[]): { tag: string; time: number; sinceLast: number | null }[] {
  const out: { tag: string; time: number; sinceLast: number | null }[] = []
  for (const c of cs) for (const tag of c.tags) out.push({ tag, time: c.time, sinceLast: null })
  out.sort((a, b) => a.time - b.time)
  out.forEach((r, i) => (r.sinceLast = i ? Math.round((r.time - out[i - 1].time) / DAY) : null))
  return out
}

// ------------------------------------------------------------------------------------------ comandos do GitTools

export interface CommandRow {
  command: string
  runs: number
  failed: number
  avgMs: number
  maxMs: number
  readOnly: boolean
}

/** Comandos que só leem: a interface os executa o tempo todo para se atualizar. */
const READ_ONLY = new Set(['status', 'log', 'show', 'diff', 'rev-parse', 'for-each-ref', 'ls-files', 'ls-tree', 'blame', 'rev-list', 'merge-base', 'cat-file', 'version', '--version'])

export function commandName(args: string[]): string {
  const name = args.find((a) => !a.startsWith('-')) ?? args[0] ?? ''
  return name
}

export function commandRows(entries: { args: string[]; durationMs?: number; failed?: boolean }[]): CommandRow[] {
  const rows = new Map<string, { runs: number; failed: number; total: number; max: number }>()
  for (const e of entries) {
    if (e.durationMs === undefined) continue
    const name = commandName(e.args)
    const r = rows.get(name) ?? { runs: 0, failed: 0, total: 0, max: 0 }
    r.runs++
    if (e.failed) r.failed++
    r.total += e.durationMs
    r.max = Math.max(r.max, e.durationMs)
    rows.set(name, r)
  }
  return [...rows.entries()]
    .map(([command, r]) => ({ command, runs: r.runs, failed: r.failed, avgMs: r.total / r.runs, maxMs: r.max, readOnly: READ_ONLY.has(command) }))
    .sort((a, b) => b.runs - a.runs)
}
