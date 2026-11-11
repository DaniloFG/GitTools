import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { readdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { onGitCommand } from '../src/core/exec'
import type { GitRepository } from '../src/core/repository'
import { AnalyticsCache } from '../src/backend/analyticsCache'
import { decodeAnalytics, type AnalyticsWire } from '../src/shared/analyticsWire'
import type { Analytics } from '../src/shared/types'
import { createRepo } from './helpers'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

function cacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gittools-analytics-cache-'))
  dirs.push(dir)
  return dir
}

/** Conta os processos git abertos durante `fn`, e os argumentos de cada um (cada comando avisa ao começar). */
async function countGit<T>(fn: () => Promise<T>): Promise<{ result: T; spawns: number; args: string[][] }> {
  const args: string[][] = []
  const off = onGitCommand((entry) => {
    if (entry.durationMs === undefined) args.push(entry.args)
  })
  try {
    const result = await fn()
    return { result, spawns: args.length, args }
  } finally {
    off()
  }
}

/** O resultado sem o instante de geração, que muda a cada cálculo. */
const withoutTime = (a: Analytics) => ({ ...a, generatedAt: 0 })

/** Caminho do arquivo de cache do repositório, do jeito que analyticsCache.ts o nomeia. */
const fileOf = (dir: string, root: string, scope = 'all') => join(dir, `${createHash('sha1').update(root).digest('hex')}-${scope}.json`)

async function jsonFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((n) => n.endsWith('.json'))
}

describe('AnalyticsCache', () => {
  it('primeira leitura calcula (4 processos); a mesma instância responde da memória (1 processo)', async () => {
    const r = await createRepo()
    await r.commit('one', { 'a.txt': 'a\n' })
    await r.commit('two', { 'b.txt': 'b\n' })
    await r.git('tag', 'v1')
    const dir = cacheDir()
    const cache = new AnalyticsCache(() => dir)

    const first = await countGit(() => cache.get(r.repo, { scope: 'all' }))
    // chave, log, ls-tree do HEAD e chave de novo (a conferência depois do cálculo)
    expect(first.spawns).toBe(4)
    expect(withoutTime(decodeAnalytics(first.result))).toEqual(withoutTime(await r.repo.analytics({ scope: 'all' })))

    const second = await countGit(() => cache.get(r.repo, { scope: 'all' }))
    expect(second.spawns).toBe(1)
    expect(second.result).toBe(first.result)
    await cache.flush()
  })

  it('um novo AnalyticsCache na mesma pasta (reinício) lê o disco com 1 processo e o conteúdo é igual', async () => {
    const r = await createRepo()
    await r.commit('one', { 'a.txt': 'a\n' })
    const dir = cacheDir()
    const before = new AnalyticsCache(() => dir)
    const first = await before.get(r.repo, { scope: 'all' })
    await before.flush()

    const restarted = new AnalyticsCache(() => dir)
    const again = await countGit(() => restarted.get(r.repo, { scope: 'all' }))
    expect(again.spawns).toBe(1)
    expect(again.result).toEqual(first)
    expect(withoutTime(decodeAnalytics(again.result))).toEqual(withoutTime(await r.repo.analytics({ scope: 'all' })))
  })

  it('depois de um commit novo é miss e o resultado traz o commit; stage de arquivo continua hit', async () => {
    const r = await createRepo()
    await r.commit('one', { 'a.txt': 'a\n' })
    const dir = cacheDir()
    const cache = new AnalyticsCache(() => dir)
    await cache.get(r.repo, { scope: 'all' })
    await cache.flush()

    r.write('c.txt', 'c\n')
    await r.git('add', 'c.txt')
    const staged = await countGit(() => cache.get(r.repo, { scope: 'all' }))
    expect(staged.spawns).toBe(1)

    const newSha = await r.commit('three', { 'd.txt': 'd\n' })
    const miss = await countGit(() => cache.get(r.repo, { scope: 'all' }))
    expect(miss.spawns).toBe(4)
    const decoded = decodeAnalytics(miss.result)
    expect(decoded.commits[0].sha).toBe(newSha)
    expect(decoded.commits[0].subject).toBe('three')
    await cache.flush()
  })

  it('arquivo de cache corrompido vira miss sem lançar erro, e é regravado', async () => {
    const r = await createRepo()
    await r.commit('one', { 'a.txt': 'a\n' })
    const dir = cacheDir()
    const seed = new AnalyticsCache(() => dir)
    await seed.get(r.repo, { scope: 'all' })
    await seed.flush()

    const [name] = await jsonFiles(dir)
    await writeFile(join(dir, name), '{ isto não é json')

    const cache = new AnalyticsCache(() => dir)
    const result = await countGit(() => cache.get(r.repo, { scope: 'all' }))
    expect(result.spawns).toBe(4)
    await cache.flush()

    const stored = JSON.parse(await readFile(fileOf(dir, r.repo.root), 'utf8')) as { key: string; root: string; wire: AnalyticsWire }
    expect(stored.root).toBe(r.repo.root)
    expect(stored.wire.sha).toEqual((result.result as AnalyticsWire).sha)
  })

  it('duas leituras simultâneas num miss executam o git log uma vez só', async () => {
    const r = await createRepo()
    await r.commit('one', { 'a.txt': 'a\n' })
    const dir = cacheDir()
    const cache = new AnalyticsCache(() => dir)

    const both = await countGit(() => Promise.all([cache.get(r.repo, { scope: 'all' }), cache.get(r.repo, { scope: 'all' })]))
    const logs = both.args.filter((a) => a[0] === 'log')
    expect(logs).toHaveLength(1)
    expect(both.result[0]).toBe(both.result[1])
    await cache.flush()
  })

  it('escopos "head" e "all" são entradas separadas', async () => {
    const r = await createRepo()
    const first = await r.commit('one', { 'a.txt': 'a\n' })
    await r.git('branch', 'other')
    await r.commit('two', { 'b.txt': 'b\n' })
    await r.git('checkout', '-q', 'other')
    await r.commit('three', { 'c.txt': 'c\n' })
    const dir = cacheDir()
    const cache = new AnalyticsCache(() => dir)

    const all = decodeAnalytics(await cache.get(r.repo, { scope: 'all' }))
    const head = decodeAnalytics(await cache.get(r.repo, { scope: 'head' }))
    await cache.flush()
    expect(all.scope).toBe('all')
    expect(head.scope).toBe('head')
    expect(all.commits.length).toBeGreaterThan(head.commits.length)
    expect(head.commits.some((c) => c.sha === first)).toBe(true)

    expect(await jsonFiles(dir)).toHaveLength(2)
    // Pedir de novo cada escopo acerta a entrada certa, sem trocar uma pela outra.
    expect(decodeAnalytics(await cache.get(r.repo, { scope: 'head' })).commits.length).toBe(head.commits.length)
    expect(decodeAnalytics(await cache.get(r.repo, { scope: 'all' })).commits.length).toBe(all.commits.length)
  })

  it('a pasta fica com no máximo 16 arquivos, saindo os mais antigos', async () => {
    const r = await createRepo()
    await r.commit('one', { 'a.txt': 'a\n' })
    const dir = cacheDir()
    // 20 arquivos de outros repositórios, todos mais antigos que o que vai ser gravado agora.
    for (let i = 0; i < 20; i++) {
      const name = join(dir, `old-${i}.json`)
      await writeFile(name, '{}')
      const past = new Date(Date.now() - (30 - i) * 60_000)
      await utimes(name, past, past)
    }
    const cache = new AnalyticsCache(() => dir)
    await cache.get(r.repo, { scope: 'all' })
    await cache.flush()

    const names = await jsonFiles(dir)
    expect(names.length).toBeLessThanOrEqual(16)
    expect(names).toContain(fileOf(dir, r.repo.root).split(/[\\/]/).pop())
  })

  it('se o repositório muda durante o cálculo, o resultado é entregue mas não é guardado', async () => {
    const r = await createRepo()
    await r.commit('one', { 'a.txt': 'a\n' })
    const dir = cacheDir()
    const cache = new AnalyticsCache(() => dir)

    // Um repositório "de mentira" cujo `analytics` faz um commit depois de ler o log: a chave muda no meio.
    const changing = Object.create(r.repo) as GitRepository
    const original = r.repo.analytics.bind(r.repo)
    changing.analytics = async (options, known) => {
      const result = await original(options, known)
      await r.commit('durante', { 'x.txt': 'x\n' })
      return result
    }
    const delivered = decodeAnalytics(await cache.get(changing, { scope: 'all' }))
    await cache.flush()
    expect(delivered.commits.map((c) => c.subject)).toEqual(['one'])

    // Nada foi guardado sob a chave antiga: o próximo pedido, no repositório real, calcula de novo (4 processos)
    // e traz o commit novo, mesmo com um cache novo lendo o disco.
    expect(await jsonFiles(dir)).toHaveLength(0)
    const fresh = await countGit(() => new AnalyticsCache(() => dir).get(r.repo, { scope: 'all' }))
    expect(fresh.spawns).toBe(4)
    expect(decodeAnalytics(fresh.result).commits[0].subject).toBe('durante')
    await cache.flush()
  })
})
