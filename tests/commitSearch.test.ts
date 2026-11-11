import { describe, expect, it } from 'vitest'
import type { BranchCommit } from '../src/shared/types'
import {
  COMMIT_BATCH,
  MAX_SHOWN,
  batchSlice,
  checkAll,
  countChecked,
  filterCommits,
  growBatch,
  localDateKey,
  uncheckAll
} from '../src/renderer/src/commitSearch'

/** Data local ao meio-dia: o teste não depende do fuso da máquina que roda. */
const dia = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0).getTime()

function commit(over: Partial<BranchCommit> & { sha: string }): BranchCommit {
  return {
    parents: [],
    author: 'Ana Souza',
    email: 'ana@exemplo.com',
    date: dia(2024, 3, 5),
    subject: 'feat: algo',
    refs: [],
    alreadyApplied: false,
    ...over
  }
}

const A = commit({ sha: 'abc1234def5678901234567890123456789abcde', subject: 'fix: corrige login' })
const B = commit({
  sha: '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432',
  subject: 'docs: atualiza README',
  author: 'Bruno Lima',
  email: 'bruno@acme.org',
  date: dia(2023, 12, 31)
})
const lista = [A, B]

const shas = (list: readonly BranchCommit[]) => list.map((c) => c.sha)

describe('localDateKey', () => {
  it('data local no formato AAAA-MM-DD, a partir de milissegundos', () => {
    expect(localDateKey(dia(2024, 3, 5))).toBe('2024-03-05')
    expect(localDateKey(dia(2023, 12, 31))).toBe('2023-12-31')
  })

  it('o começo do dia local conta como o próprio dia', () => {
    expect(localDateKey(new Date(2024, 2, 5, 0, 30).getTime())).toBe('2024-03-05')
  })

  it('data inválida vira texto vazio, que não casa com nada', () => {
    expect(localDateKey(Number.NaN)).toBe('')
  })
})

describe('filterCommits', () => {
  it('por hash: prefixo, trecho e sha completo', () => {
    expect(shas(filterCommits(lista, 'abc1234'))).toEqual([A.sha])
    expect(shas(filterCommits(lista, 'c1234d'))).toEqual([A.sha])
    expect(shas(filterCommits(lista, '9f8e'))).toEqual([B.sha])
    expect(shas(filterCommits(lista, A.sha))).toEqual([A.sha])
  })

  it('por mensagem (subject)', () => {
    expect(shas(filterCommits(lista, 'corrige'))).toEqual([A.sha])
    expect(shas(filterCommits(lista, 'README'))).toEqual([B.sha])
  })

  it('por autor', () => {
    expect(shas(filterCommits(lista, 'bruno'))).toEqual([B.sha])
    expect(shas(filterCommits(lista, 'souza'))).toEqual([A.sha])
  })

  it('por e-mail', () => {
    expect(shas(filterCommits(lista, 'acme.org'))).toEqual([B.sha])
    expect(shas(filterCommits(lista, 'ana@exemplo'))).toEqual([A.sha])
  })

  it('por data: AAAA-MM-DD, trecho do ano-mês, trecho mês-dia e ano', () => {
    expect(shas(filterCommits(lista, '2024-03-05'))).toEqual([A.sha])
    expect(shas(filterCommits(lista, '2024-03'))).toEqual([A.sha])
    expect(shas(filterCommits(lista, '03-05'))).toEqual([A.sha])
    expect(shas(filterCommits(lista, '2023-12-31'))).toEqual([B.sha])
    expect(shas(filterCommits(lista, '2024'))).toEqual([A.sha])
    expect(shas(filterCommits(lista, '2024-03-06'))).toEqual([])
  })

  it('vários termos precisam casar todos (E), cada um em qualquer campo', () => {
    expect(shas(filterCommits(lista, 'fix ana'))).toEqual([A.sha])
    expect(shas(filterCommits(lista, 'corrige souza'))).toEqual([A.sha])
    expect(shas(filterCommits(lista, 'abc1234 souza'))).toEqual([A.sha])
    expect(shas(filterCommits(lista, 'fix bruno'))).toEqual([])
    expect(shas(filterCommits(lista, 'docs ana'))).toEqual([])
  })

  it('não diferencia maiúsculas nem minúsculas', () => {
    expect(shas(filterCommits(lista, 'FIX'))).toEqual([A.sha])
    expect(shas(filterCommits(lista, 'BRUNO LIMA'))).toEqual([B.sha])
  })

  it('query vazia ou só com espaços devolve o MESMO array, por referência', () => {
    expect(filterCommits(lista, '')).toBe(lista)
    expect(filterCommits(lista, '   ')).toBe(lista)
    expect(filterCommits(lista, '\t ')).toBe(lista)
  })

  it('espaços nas pontas do texto não atrapalham', () => {
    expect(shas(filterCommits(lista, '  fix  '))).toEqual([A.sha])
  })

  it('sem nenhum commit que case: lista vazia', () => {
    expect(filterCommits(lista, 'inexistente')).toEqual([])
  })

  it('query curta "a" casa com o sha (qualquer trecho), não só com o começo', () => {
    // X tem "a" só no meio do sha; Y não tem "a" em lugar nenhum (sha, texto, e-mail, data).
    const X = commit({ sha: '1234567890ab2cdef1234567890abcdef1234567', subject: 'xyz', author: 'Bob', email: 'bob@x.io' })
    const Y = commit({ sha: '1234567890bcdef1234567890bcdef1234567890', subject: 'xyz', author: 'Bob', email: 'bob@x.io' })
    expect(shas(filterCommits([X, Y], 'a'))).toEqual([X.sha])
    expect(shas(filterCommits([X, Y], 'A'))).toEqual([X.sha])
  })

  it('caracteres de regex são texto comum: "(", "[" e ".*" não quebram nem viram coringa', () => {
    const C = commit({ sha: 'cccc000000000000000000000000000000000000', subject: 'feat(api): x [wip]' })
    const todos = [A, B, C]
    expect(shas(filterCommits(todos, '('))).toEqual([C.sha])
    expect(shas(filterCommits(todos, '['))).toEqual([C.sha])
    expect(shas(filterCommits(todos, '(api'))).toEqual([C.sha])
    expect(shas(filterCommits(todos, '[wip'))).toEqual([C.sha])
    // Se a query virasse RegExp, ".*" casaria tudo. Como é texto, nenhum commit contém ".*".
    expect(filterCommits(todos, '.*')).toEqual([])
    expect(() => filterCommits(todos, '[')).not.toThrow()
  })
})

describe('lote da lista', () => {
  it('COMMIT_BATCH é 200 linhas', () => {
    expect(COMMIT_BATCH).toBe(200)
  })

  it('o lote devolve no máximo o pedido; lista menor que o lote vem inteira', () => {
    expect(batchSlice(lista, COMMIT_BATCH)).toHaveLength(2)
    expect(batchSlice(lista, 1)).toEqual([A])
  })
})

describe('20.000 commits sintéticos', () => {
  const grande = Array.from({ length: 20000 }, (_, i) =>
    commit({
      sha: i.toString(16).padStart(40, '0'),
      subject: `feat: item ${i} tok${i}`,
      author: `Autor ${i % 50}`,
      email: `autor${i % 50}@exemplo.com`,
      date: dia(2020, 1, 1) + i * 3600000
    })
  )

  it('a busca acha exatamente os que casam', () => {
    const achados = filterCommits(grande, 'tok1234')
    expect(shas(achados)).toEqual(shas(grande.filter((c) => c.subject.includes('tok1234'))))
  })

  it('o lote limita a lista montada a 200, mesmo com todos casando', () => {
    const todos = filterCommits(grande, 'feat')
    expect(todos).toHaveLength(20000)
    const lote = batchSlice(todos, COMMIT_BATCH)
    expect(lote).toHaveLength(COMMIT_BATCH)
    expect(shas(lote)).toEqual(shas(grande.slice(0, COMMIT_BATCH)))
  })

  it('o teto de MAX_SHOWN vale mesmo quando quem chama pede mais', () => {
    expect(MAX_SHOWN).toBe(600)
    expect(batchSlice(grande, 100000)).toHaveLength(600)
    expect(batchSlice(grande, 100000)).toHaveLength(MAX_SHOWN)
  })
})

describe('crescimento do lote', () => {
  it('cada "Mostrar mais" soma um lote, até o teto', () => {
    expect(growBatch(COMMIT_BATCH)).toBe(400)
    expect(growBatch(400)).toBe(600)
    expect(growBatch(600)).toBe(600)
  })
})

describe('Todos e Nenhum com busca ativa', () => {
  // Fora da busca: já marcado, pendente. Dentro da busca: A (pendente) e P (já aplicado no destino).
  const P = commit({ sha: 'pppp000000000000000000000000000000000000', alreadyApplied: true })

  it('"Todos" soma os pendentes da busca ao que já estava marcado, sem tocar nos escondidos', () => {
    const marcados = new Set([B.sha])
    const resultado = checkAll(marcados, [A, P])
    expect([...resultado].sort()).toEqual([A.sha, B.sha].sort())
    expect(marcados.size).toBe(1)
    expect(resultado).not.toBe(marcados)
  })

  it('"Nenhum" tira só os commits da busca; os marcados fora dela continuam', () => {
    const marcados = new Set([A.sha, B.sha])
    const resultado = uncheckAll(marcados, [A])
    expect([...resultado]).toEqual([B.sha])
    expect(marcados.size).toBe(2)
    expect(resultado).not.toBe(marcados)
  })

  it('contagem de marcados dentro de uma lista', () => {
    expect(countChecked(new Set([A.sha, B.sha]), lista)).toBe(2)
    expect(countChecked(new Set([A.sha, B.sha]), [A])).toBe(1)
    expect(countChecked(new Set(), lista)).toBe(0)
  })
})
