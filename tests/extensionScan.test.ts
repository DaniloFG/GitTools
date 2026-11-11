// Varredura do workspace na extensão com leituras em paralelo (item 5.4): o resultado tem de ser idêntico ao
// da varredura em série de hoje (`findRepositories`), inclusive quando o teto de 5.000 pastas ou o limite de
// repositórios corta a busca no meio; e as leituras ao mesmo tempo ficam poucas.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findRepositories } from '../src/core/discover'
import { findRepositoriesConcurrent, mapLimit, SCAN_CONCURRENCY, waitsForDiscovery } from '../extension/src/discover'

// Mede quantas leituras de pasta correm ao mesmo tempo (as duas varreduras usam este `readdir`).
const reads = { inFlight: 0, max: 0, total: 0 }
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      reads.total++
      reads.max = Math.max(reads.max, ++reads.inFlight)
      try {
        return await actual.readdir(...args)
      } finally {
        reads.inFlight--
      }
    }
  }
})

const dirs: string[] = []
beforeEach(() => Object.assign(reads, { max: 0, total: 0 }))
afterEach(async () => {
  // A varredura paralela não espera as leituras adiantadas que sobraram ao atingir um teto: elas terminam sozinhas.
  while (reads.inFlight > 0) await new Promise((r) => setTimeout(r, 5))
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** Gerador pseudoaleatório fixo: a mesma árvore em toda execução. */
function random(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return seed / 2 ** 31
  }
}

/** Árvore de pastas com repositórios (.git pasta ou arquivo), pastas ignoradas, links e profundidade além do limite. */
function tree(seed: number, width: number, depth: number) {
  const base = mkdtempSync(join(tmpdir(), 'gittools-scan-'))
  dirs.push(base)
  const rnd = random(seed)
  const make = (folder: string, level: number) => {
    const r = rnd()
    if (r < 0.25) mkdirSync(join(folder, '.git'))
    else if (r < 0.3) writeFileSync(join(folder, '.git'), 'gitdir: ../outro\n')
    if (level >= depth) return
    const count = 1 + Math.floor(rnd() * width)
    for (let i = 0; i < count; i++) {
      const name = rnd() < 0.08 ? ['node_modules', 'dist', 'build'][i % 3] : `p${Math.floor(rnd() * 1000)}-${i}`
      const child = join(folder, name)
      mkdirSync(child, { recursive: true })
      make(child, level + 1)
    }
    if (rnd() < 0.1) symlinkSync(folder, join(folder, `link${level}`))
  }
  make(base, 0)
  return base
}

/** Pasta com `count` subpastas vazias por nível em dois níveis (mais que o teto de 5.000) e repositórios espalhados. */
function huge() {
  const base = mkdtempSync(join(tmpdir(), 'gittools-scan-huge-'))
  dirs.push(base)
  for (let a = 0; a < 80; a++) {
    for (let b = 0; b < 80; b++) {
      const dir = join(base, `a${String(a).padStart(2, '0')}`, `b${String(b).padStart(2, '0')}`)
      mkdirSync(dir, { recursive: true })
      if ((a * 80 + b) % 97 === 0) mkdirSync(join(dir, '.git'))
    }
  }
  return base
}

describe('findRepositoriesConcurrent: mesmo resultado da varredura em série', () => {
  it('árvores variadas, com e sem opções', async () => {
    for (const seed of [1, 7, 42, 2024]) {
      const base = tree(seed, 4, 6)
      for (const options of [{}, { maxDepth: 2 }, { maxDepth: 0 }, { limit: 3 }, { limit: 1, maxDepth: 6 }, { ignore: ['dist'] }]) {
        expect(await findRepositoriesConcurrent([base], options)).toEqual(await findRepositories([base], options))
      }
    }
  })

  it('várias raízes (repetidas, uma dentro da outra, inexistente), na ordem recebida', async () => {
    const a = tree(3, 3, 4)
    const b = tree(5, 3, 4)
    const roots = [b, a, join(a, 'nao-existe'), a, b]
    expect(await findRepositoriesConcurrent(roots)).toEqual(await findRepositories(roots))
  })

  it('o teto de 5.000 pastas corta a busca no mesmo ponto', async () => {
    const base = huge()
    const options = { limit: 1000 }
    const serial = await findRepositories([base], options)
    const serialReads = reads.total
    reads.total = 0
    const concurrent = await findRepositoriesConcurrent([base], options)
    expect(concurrent).toEqual(serial)
    // O teto vale: a série lê exatamente 5.000 pastas; a paralela, no máximo umas poucas adiantadas a mais.
    expect(serialReads).toBe(5000)
    expect(reads.total).toBeGreaterThanOrEqual(5000)
    expect(reads.total).toBeLessThanOrEqual(5000 + 40)
  })

  it('lê várias pastas ao mesmo tempo, mas poucas', async () => {
    const base = huge()
    await findRepositories([base])
    expect(reads.max).toBe(1)
    reads.max = 0
    await findRepositoriesConcurrent([base])
    expect(reads.max).toBeGreaterThan(1)
    // As adiantadas mais a que o percurso pede na hora.
    expect(reads.max).toBeLessThanOrEqual(SCAN_CONCURRENCY + 1)
  })
})

describe('mapLimit', () => {
  it('devolve na ordem dos itens e respeita o limite', async () => {
    let running = 0
    let max = 0
    const result = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (n) => {
      max = Math.max(max, ++running)
      await new Promise((r) => setTimeout(r, n * 3))
      running--
      return n * 10
    })
    expect(result).toEqual([50, 10, 40, 20, 30, 0])
    expect(max).toBe(2)
    expect(await mapLimit([], 4, async (n) => n)).toEqual([])
  })
})

describe('waitsForDiscovery', () => {
  it('a lista de abertos e os pedidos ao repositório esperam; configurações e informações não', () => {
    expect(waitsForDiscovery('app:openRepositories')).toBe(true)
    expect(waitsForDiscovery('app:currentRepository')).toBe(true)
    expect(waitsForDiscovery('repo:invoke')).toBe(true)
    expect(waitsForDiscovery('app:getSettings')).toBe(false)
    expect(waitsForDiscovery('app:info')).toBe(false)
  })
})
