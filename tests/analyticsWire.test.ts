import { describe, expect, it } from 'vitest'
import { decodeAnalytics, encodeAnalytics, isAnalyticsWire } from '../src/shared/analyticsWire'
import type { Analytics, AnalyticsCommit } from '../src/shared/types'

function commit(overrides: Partial<AnalyticsCommit> = {}): AnalyticsCommit {
  return {
    sha: 'a'.repeat(40),
    parents: 1,
    author: 'Ana',
    email: 'ana@example.com',
    committer: 'Ana',
    committerEmail: 'ana@example.com',
    time: 1_700_000_000_000,
    commitTime: 1_700_000_000_000,
    subject: 'feat: algo',
    bodyLength: 0,
    signedOff: false,
    coAuthors: 0,
    tags: [],
    files: [],
    ...overrides
  }
}

function analytics(overrides: Partial<Analytics> = {}): Analytics {
  return {
    scope: 'all',
    commits: [],
    paths: [],
    truncated: false,
    tree: [],
    generatedAt: 1_700_000_123_456,
    ...overrides
  }
}

/** Gerador determinístico (LCG): o mesmo conjunto sempre sai igual, sem depender de Math.random. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/** Repositório parecido com o real: poucos autores repetidos, mensagens curtas, datas em segundos inteiros. */
function realisticDataset(count: number): Analytics {
  const rand = rng(42)
  const people = Array.from({ length: 40 }, (_, i) => ({ name: `Autor ${i}`, email: `autor${i}@example.com` }))
  const paths = Array.from({ length: 800 }, (_, i) => `src/modulo${i % 50}/arquivo${i}.ts`)
  const hex = '0123456789abcdef'
  const shaOf = () => Array.from({ length: 40 }, () => hex[Math.floor(rand() * 16)]).join('')
  const commits: AnalyticsCommit[] = []
  let time = 1_600_000_000_000
  for (let i = 0; i < count; i++) {
    time -= Math.floor(rand() * 4) * 1000 * 60
    const a = people[Math.floor(rand() * people.length)]
    const c = rand() < 0.8 ? a : people[Math.floor(rand() * people.length)]
    const files: [number, number, number][] = []
    const nFiles = Math.floor(rand() * 6)
    for (let f = 0; f < nFiles; f++) {
      const binary = rand() < 0.05
      files.push([Math.floor(rand() * paths.length), binary ? -1 : Math.floor(rand() * 80), binary ? -1 : Math.floor(rand() * 40)])
    }
    commits.push(
      commit({
        sha: shaOf(),
        parents: rand() < 0.1 ? 2 : 1,
        author: a.name,
        email: a.email,
        committer: c.name,
        committerEmail: c.email,
        time,
        commitTime: time + 1000,
        subject: `Ajusta o modulo ${i % 50} na rotina ${i}`,
        bodyLength: Math.floor(rand() * 300),
        signedOff: rand() < 0.2,
        coAuthors: rand() < 0.1 ? 1 : 0,
        tags: rand() < 0.02 ? [`v${i}`] : [],
        files
      })
    )
  }
  return analytics({
    commits,
    paths,
    tree: paths.map((path, i) => ({ path, size: 100 + i * 7 }))
  })
}

describe('analyticsWire: ida e volta', () => {
  it('repositório sem commits', () => {
    const x = analytics({ scope: 'head', truncated: true, paths: ['a'], tree: [{ path: 'a', size: 0 }] })
    const w = encodeAnalytics(x)
    expect(w.sha).toEqual([])
    expect(decodeAnalytics(w)).toEqual(x)
  })

  it('arquivos binários (-1, -1) e commits sem arquivo', () => {
    const x = analytics({
      commits: [
        commit({ files: [[0, -1, -1], [1, 3, 0]] }),
        commit({ sha: 'b'.repeat(40), files: [] }),
        commit({ sha: 'c'.repeat(40), files: [[1, -1, -1]] })
      ],
      paths: ['img.png', 'src/a.ts']
    })
    expect(decodeAnalytics(encodeAnalytics(x))).toEqual(x)
  })

  it('tags só em alguns commits, e tags em ordem própria', () => {
    const x = analytics({
      commits: [
        commit({ tags: [] }),
        commit({ sha: 'b'.repeat(40), tags: ['v1.0.0', 'latest'] }),
        commit({ sha: 'c'.repeat(40) }),
        commit({ sha: 'd'.repeat(40), tags: ['v2'] })
      ]
    })
    const w = encodeAnalytics(x)
    expect(w.tagCommit).toEqual([1, 3])
    expect(w.tagCount).toEqual([2, 1])
    expect(decodeAnalytics(w)).toEqual(x)
  })

  it('autores repetidos e autor igual ao committer', () => {
    const x = analytics({
      commits: [
        commit(),
        commit({ sha: 'b'.repeat(40), committer: 'Bruno', committerEmail: 'bruno@example.com' }),
        commit({ sha: 'c'.repeat(40), author: 'Bruno', email: 'bruno@example.com', committer: 'Bruno', committerEmail: 'bruno@example.com' })
      ]
    })
    const w = encodeAnalytics(x)
    // Ana (autor e committer) e Bruno: dois pares na tabela, não quatro.
    expect(w.peopleName).toEqual(['Ana', 'Bruno'])
    expect(w.author).toEqual([0, 0, 1])
    expect(w.committer).toEqual([0, 1, 1])
    expect(decodeAnalytics(w)).toEqual(x)
  })

  it('nomes e assuntos com unicode, \\u0000, separadores \\x1f e \\x1e', () => {
    const x = analytics({
      commits: [
        commit({ author: 'José\u0000', email: 'j@x', committer: 'Zoë\x1fX', committerEmail: 'z@x' }),
        commit({ sha: 'b'.repeat(40), author: 'José', email: '\u0000j@x', subject: 'título \x1e com \x1f e 😀 \uD83D', bodyLength: 9 }),
        commit({ sha: 'c'.repeat(40), author: '3:Ana', email: 'x' }),
        commit({ sha: 'd'.repeat(40), author: '3:', email: 'Ana' }),
        commit({ sha: 'e'.repeat(40), author: '', email: '' })
      ],
      paths: ['pasta\x1e/arquivo\u0000.txt', 'ação/ç.md'],
      tree: [{ path: 'ação\x1f.txt', size: 1 }]
    })
    const w = encodeAnalytics(x)
    // "3:Ana"+"x" e "3:"+"Ana" não podem colidir na tabela de pessoas.
    expect(new Set(w.peopleName.map((n, i) => n + '|' + w.peopleEmail[i])).size).toBe(w.peopleName.length)
    expect(decodeAnalytics(w)).toEqual(x)
  })

  it('tempos fora de múltiplos de 1000 caem para milissegundos, sem perda', () => {
    const x = analytics({
      commits: [commit({ time: 1_700_000_000_123, commitTime: 1_700_000_000_000 }), commit({ sha: 'b'.repeat(40), time: 1_700_000_000_000, commitTime: 1_700_000_001_000 })]
    })
    const w = encodeAnalytics(x)
    expect(w.timeSec).toBe(false)
    expect(w.commitTimeSec).toBe(true)
    expect(w.time).toEqual([1_700_000_000_123, 1_700_000_000_000])
    expect(w.commitTime).toEqual([1_700_000_000, 1_700_000_001])
    expect(decodeAnalytics(w)).toEqual(x)
  })

  it('tempo fracionário e tempo enorme (acima de 2^53 em segundos) também voltam iguais', () => {
    const x = analytics({
      commits: [commit({ time: 1.5 }), commit({ sha: 'b'.repeat(40), commitTime: 9.007199254740993e18 })]
    })
    const w = encodeAnalytics(x)
    expect(w.timeSec).toBe(false)
    expect(w.commitTimeSec).toBe(false)
    expect(decodeAnalytics(w)).toEqual(x)
  })

  it('caminhos de arquivo e árvore vazios e repetidos', () => {
    const x = analytics({
      commits: [commit({ files: [[0, 1, 1], [0, 1, 1]] })],
      paths: ['a', 'a'],
      tree: [{ path: 'a', size: 5 }, { path: 'a', size: 5 }]
    })
    expect(decodeAnalytics(encodeAnalytics(x))).toEqual(x)
  })

  it('o encode não altera a entrada', () => {
    const x = analytics({ commits: [commit({ tags: ['v1'], files: [[0, 1, 2]] })], paths: ['a'] })
    const copia = structuredClone(x)
    encodeAnalytics(x)
    expect(x).toEqual(copia)
  })

  it('conjunto grande gerado (5000 commits) volta igual', () => {
    const x = realisticDataset(5000)
    expect(decodeAnalytics(encodeAnalytics(x))).toEqual(x)
  })
})

describe('analyticsWire: tamanho', () => {
  it('o JSON codificado é menor que o original para um conjunto realista', () => {
    const x = realisticDataset(5000)
    const original = JSON.stringify(x).length
    const encoded = JSON.stringify(encodeAnalytics(x)).length
    const ratio = encoded / original
    console.log(`analyticsWire: ${original} bytes -> ${encoded} bytes (${(ratio * 100).toFixed(1)}%)`)
    expect(encoded).toBeLessThan(original)
  })
})

describe('isAnalyticsWire', () => {
  it('reconhece o que o encode produz', () => {
    expect(isAnalyticsWire(encodeAnalytics(analytics()))).toBe(true)
  })

  it('recusa Analytics comum, valores nulos, listas e outra versão', () => {
    expect(isAnalyticsWire(analytics())).toBe(false)
    expect(isAnalyticsWire(null)).toBe(false)
    expect(isAnalyticsWire(undefined)).toBe(false)
    expect(isAnalyticsWire('analytics-v1')).toBe(false)
    expect(isAnalyticsWire([])).toBe(false)
    expect(isAnalyticsWire({ wire: 'analytics-v2', sha: [], peopleName: [], fileData: [] })).toBe(false)
    expect(isAnalyticsWire({ wire: 'analytics-v1' })).toBe(false)
  })
})

describe('decodeAnalytics: colunas inconsistentes', () => {
  it('falha com mensagem clara quando uma coluna de commit perde um item', () => {
    const w = encodeAnalytics(analytics({ commits: [commit(), commit({ sha: 'b'.repeat(40) })] }))
    w.subject = w.subject.slice(1)
    expect(() => decodeAnalytics(w)).toThrow(/analyticsWire: coluna "subject" tem 1 itens, esperado 2/)
  })

  it('falha quando fileData não bate com fileCount', () => {
    const w = encodeAnalytics(analytics({ commits: [commit({ files: [[0, 1, 1]] })], paths: ['a'] }))
    w.fileData = [0, 1]
    expect(() => decodeAnalytics(w)).toThrow(/fileData/)
  })

  it('falha com índice de pessoa fora da tabela', () => {
    const w = encodeAnalytics(analytics({ commits: [commit()] }))
    w.author = [7]
    expect(() => decodeAnalytics(w)).toThrow(/índice 7 fora/)
  })

  it('falha quando as tags não cobrem os nomes', () => {
    const w = encodeAnalytics(analytics({ commits: [commit({ tags: ['v1'] })] }))
    w.tagNames = [...w.tagNames, 'extra']
    expect(() => decodeAnalytics(w)).toThrow(/tagNames/)
  })

  it('falha com sinalizador de versão desconhecido', () => {
    const w = { ...encodeAnalytics(analytics()), wire: 'analytics-v9' as 'analytics-v1' }
    expect(() => decodeAnalytics(w)).toThrow(/não suportada/)
  })
})
