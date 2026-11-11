import { describe, expect, it } from 'vitest'
import { onGitCommand } from '../src/core/exec'
import { createRepo } from './helpers'

/** Conta os processos git abertos durante `fn` (cada comando avisa ao começar, sem `durationMs`). */
async function countGit<T>(fn: () => Promise<T>): Promise<{ result: T; spawns: number }> {
  let spawns = 0
  const off = onGitCommand((entry) => {
    if (entry.durationMs === undefined) spawns++
  })
  try {
    const result = await fn()
    return { result, spawns }
  } finally {
    off()
  }
}

/** O resultado de `analytics` sem o instante de geração, que muda a cada chamada. */
const withoutTime = <T extends { generatedAt: number }>(a: T) => ({ ...a, generatedAt: 0 })

describe('analyticsKey', () => {
  it('fica igual entre duas chamadas sem mudança', async () => {
    const r = await createRepo()
    await r.commit('one', { 'a.txt': 'a\n' })
    const k1 = await r.repo.analyticsKey({ scope: 'all' })
    const k2 = await r.repo.analyticsKey({ scope: 'all' })
    expect(k1).toEqual(k2)
    expect(k1.hasHead).toBe(true)
  })

  it('não muda com índice, stash, nem com checkout de outra branch no mesmo commit', async () => {
    const r = await createRepo()
    await r.commit('one', { 'a.txt': 'a\n' })
    // A branch é criada antes da primeira chave: a própria criação de ref mudaria a chave.
    await r.git('branch', 'other')
    const before = await r.repo.analyticsKey({ scope: 'all' })

    r.write('b.txt', 'novo\n')
    await r.git('add', 'b.txt')
    expect(await r.repo.analyticsKey({ scope: 'all' })).toEqual(before)

    r.write('a.txt', 'alterado\n')
    await r.git('stash', '-q')
    expect(await r.repo.analyticsKey({ scope: 'all' })).toEqual(before)

    await r.git('checkout', '-q', 'other')
    expect(await r.repo.analyticsKey({ scope: 'all' })).toEqual(before)
  })

  it('muda com novo commit, nova tag, tag movida (mesma quantidade), branch apagada e ref de rastreamento', async () => {
    const r = await createRepo()
    const first = await r.commit('one', { 'a.txt': 'a\n' })
    const k0 = await r.repo.analyticsKey({ scope: 'all' })

    const second = await r.commit('two', { 'a.txt': 'b\n' })
    const k1 = await r.repo.analyticsKey({ scope: 'all' })
    expect(k1.key).not.toBe(k0.key)

    await r.git('tag', 'v1', first)
    const k2 = await r.repo.analyticsKey({ scope: 'all' })
    expect(k2.key).not.toBe(k1.key)

    // Mover a tag mantém a quantidade de tags: só o sha muda, e a chave tem que perceber.
    await r.git('tag', '-f', 'v1', second)
    const k3 = await r.repo.analyticsKey({ scope: 'all' })
    expect(k3.key).not.toBe(k2.key)

    await r.git('branch', 'gone', first)
    const k4 = await r.repo.analyticsKey({ scope: 'all' })
    expect(k4.key).not.toBe(k3.key)
    await r.git('branch', '-D', 'gone')
    const k5 = await r.repo.analyticsKey({ scope: 'all' })
    expect(k5.key).not.toBe(k4.key)

    await r.git('update-ref', 'refs/remotes/origin/x', first)
    const k6 = await r.repo.analyticsKey({ scope: 'all' })
    expect(k6.key).not.toBe(k5.key)
  })

  it('ignora refs fora de heads, remotes e tags (notas)', async () => {
    const r = await createRepo()
    const sha = await r.commit('one', { 'a.txt': 'a\n' })
    const before = await r.repo.analyticsKey({ scope: 'all' })
    await r.git('update-ref', 'refs/notes/commits', sha)
    expect(await r.repo.analyticsKey({ scope: 'all' })).toEqual(before)
  })

  it('no escopo head muda só com o sha do HEAD', async () => {
    const r = await createRepo()
    await r.commit('one', { 'a.txt': 'a\n' })
    const before = await r.repo.analyticsKey({ scope: 'head' })

    r.write('b.txt', 'x\n')
    await r.git('add', 'b.txt')
    await r.git('tag', 'v1')
    await r.git('branch', 'other')
    expect((await r.repo.analyticsKey({ scope: 'head' })).key).toBe(before.key)

    await r.commit('two', { 'a.txt': 'b\n' })
    expect((await r.repo.analyticsKey({ scope: 'head' })).key).not.toBe(before.key)
  })

  it('é diferente entre escopos e entre limites', async () => {
    const r = await createRepo()
    await r.commit('one', { 'a.txt': 'a\n' })
    const all = await r.repo.analyticsKey({ scope: 'all' })
    const head = await r.repo.analyticsKey({ scope: 'head' })
    expect(all.key).not.toBe(head.key)
    const small = await r.repo.analyticsKey({ scope: 'all', limit: 10 })
    const big = await r.repo.analyticsKey({ scope: 'all', limit: 20 })
    expect(small.key).not.toBe(big.key)
  })

  it('repositório sem commit: hasHead falso e analytics igual ao resultado sem pistas', async () => {
    const r = await createRepo()
    const key = await r.repo.analyticsKey({})
    expect(key.hasHead).toBe(false)
    expect(key.key).toMatch(/^[0-9a-f]{40}$/)
    expect(withoutTime(await r.repo.analytics({}, { hasHead: false }))).toEqual(withoutTime(await r.repo.analytics({})))
  })

  it('com HEAD destacado também acha o HEAD', async () => {
    const r = await createRepo()
    await r.commit('one', { 'a.txt': 'a\n' })
    await r.git('checkout', '-q', '--detach')
    const key = await r.repo.analyticsKey({ scope: 'all' })
    expect(key.hasHead).toBe(true)
  })

  it('faz um único processo git no escopo all e no head', async () => {
    const r = await createRepo()
    await r.commit('one', { 'a.txt': 'a\n' })
    expect((await countGit(() => r.repo.analyticsKey({ scope: 'all' }))).spawns).toBe(1)
    expect((await countGit(() => r.repo.analyticsKey({ scope: 'head' }))).spawns).toBe(1)
  })
})

describe('analytics com hasHead conhecido', () => {
  it('com hasHead verdadeiro, o resultado é igual ao de analytics sem pistas', async () => {
    const r = await createRepo()
    await r.commit('one', { 'a.txt': 'a\n', 'img.bin': '\x00\x01\x02\x03' })
    await r.git('tag', '-a', 'v1', '-m', 'release')
    await r.commit('two', { 'a.txt': 'a\nb\n' })
    await r.git('branch', 'feature')
    for (const options of [{}, { scope: 'head' as const }, { scope: 'all' as const, limit: 2 }]) {
      const plain = await r.repo.analytics(options)
      const known = await r.repo.analytics(options, { hasHead: true })
      expect(withoutTime(known)).toEqual(withoutTime(plain))
      expect(plain.commits.length).toBeGreaterThan(0)
    }
  })

  it('pula o rev-parse quando hasHead é informado', async () => {
    const r = await createRepo()
    await r.commit('one', { 'a.txt': 'a\n' })
    const { spawns } = await countGit(() => r.repo.analytics({}, { hasHead: true }))
    const plain = await countGit(() => r.repo.analytics({}))
    expect(plain.spawns - spawns).toBe(1)
  })
})
