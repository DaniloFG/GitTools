import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { gitInesperado } from '../scripts/validacao/lib.mjs'
import { validarCenario } from '../scripts/validacao/e2e/relatorio.mjs'
import { createRepo } from './helpers'

const execFileAsync = promisify(execFile)
const ORCAMENTO = { ms: 15000, nos: 5000, erros: 0, git: 0 }

/** Um cenário válido; `extra` sobrescreve campos. */
function cenario(extra: Record<string, unknown> = {}) {
  return { id: 'funcional', tela: 'Changes', area: 'alteracoes', orcamento: ORCAMENTO, passos: async () => undefined, ...extra }
}

describe('validarCenario: campos opcionais dos cenários que escrevem', () => {
  it('aceita escreve verdadeiro/falso e gitTolerado com expressões', () => {
    expect(validarCenario(cenario({ escreve: true }), new Set())).toEqual([])
    expect(validarCenario(cenario({ escreve: false }), new Set())).toEqual([])
    expect(validarCenario(cenario({ gitTolerado: [/^git cherry-pick /] }), new Set())).toEqual([])
    expect(validarCenario(cenario({ gitTolerado: [] }), new Set())).toEqual([])
  })

  it('reprova escreve que não é booleano e gitTolerado que não é lista de expressões', () => {
    expect(validarCenario(cenario({ escreve: 'sim' }), new Set())).toEqual(['"funcional": escreve deve ser true ou false'])
    expect(validarCenario(cenario({ escreve: 1 }), new Set())).toEqual(['"funcional": escreve deve ser true ou false'])
    expect(validarCenario(cenario({ gitTolerado: '^git' }), new Set())).toEqual(['"funcional": gitTolerado deve ser uma lista de expressões regulares'])
    expect(validarCenario(cenario({ gitTolerado: ['^git'] }), new Set())).toEqual(['"funcional": gitTolerado deve ser uma lista de expressões regulares'])
    expect(validarCenario(cenario({ gitTolerado: [/a/, null] }), new Set())).toEqual(['"funcional": gitTolerado deve ser uma lista de expressões regulares'])
  })
})

describe('gitInesperado com cenário que escreve', () => {
  const escritas = [
    { args: ['add', '--', 'a.txt'], exitCode: 0 },
    { args: ['-c', 'core.quotepath=off', 'commit', '-m', 'x'], exitCode: 0 },
    { args: ['branch', 'nova'], exitCode: 0 },
    { args: ['stash', 'push', '-m', 'x'], exitCode: 0 },
    { args: ['restore', '--staged', '--pathspec-from-file=-'], exitCode: 0 }
  ]

  it('sem opções reprova a escrita, como antes', () => {
    expect(gitInesperado(escritas)).toHaveLength(5)
    expect(gitInesperado(escritas, {})).toHaveLength(5)
    expect(gitInesperado(escritas, { escreve: false })).toHaveLength(5)
  })

  it('com escreve: true a escrita que deu certo passa', () => {
    expect(gitInesperado(escritas, { escreve: true })).toEqual([])
  })

  it('com escreve: true a escrita que saiu com erro continua reprovando, e a leitura com erro também', () => {
    const ruins = gitInesperado(
      [
        { args: ['commit', '-m', 'x'], exitCode: 1 },
        { args: ['rev-parse', '--verify', 'x'], exitCode: 128 },
        { args: ['status', '--porcelain=v2'], exitCode: 0 }
      ],
      { escreve: true }
    )
    expect(ruins).toHaveLength(2)
    expect(ruins[0]).toContain('git commit -m x (saiu com 1)')
    expect(ruins[1]).toContain('saiu com 128')
  })

  it('processo ainda rodando (sem exitCode) de escrita passa com escreve: true', () => {
    expect(gitInesperado([{ args: ['add', 'a'] }], { escreve: true })).toEqual([])
    expect(gitInesperado([{ args: ['add', 'a'] }])).toHaveLength(1)
  })

  it('tolerado tira da conta só as chamadas que casam, mesmo com erro', () => {
    const log = [
      { args: ['cherry-pick', 'abc'], exitCode: 1 },
      { args: ['rev-parse', '--verify', 'x'], exitCode: 128 }
    ]
    const resultado = gitInesperado(log, { escreve: true, tolerado: [/^git cherry-pick /] })
    expect(resultado).toHaveLength(1)
    expect(resultado[0]).toContain('rev-parse')
  })

  it('expressão tolerada com a flag g não guarda posição entre chamadas', () => {
    const log = [
      { args: ['cherry-pick', 'a'], exitCode: 1 },
      { args: ['cherry-pick', 'b'], exitCode: 1 },
      { args: ['cherry-pick', 'c'], exitCode: 1 }
    ]
    expect(gitInesperado(log, { tolerado: [/^git cherry-pick /g] })).toEqual([])
  })
})

describe('git de verdade, assíncrono: a conta do cenário que escreve', () => {
  it('um commit real e um cherry-pick com conflito: o conflito sai com 1 e só ele reprova', async () => {
    const r = await createRepo()
    await r.commit('base', { 'a.txt': 'base\n' })
    await r.git('switch', '-q', '-c', 'outra')
    await r.commit('lado', { 'a.txt': 'lado\n' })
    const lado = (await r.git('rev-parse', 'HEAD')).trim()
    await r.git('switch', '-q', 'main')
    await r.commit('principal', { 'a.txt': 'principal\n' })
    // Mesma forma da entrada do log do backend: argumentos e código de saída.
    const rodar = async (args: string[]) => {
      try {
        await execFileAsync('git', args, { cwd: r.dir })
        return { args, exitCode: 0 }
      } catch (erro) {
        return { args, exitCode: (erro as { code: number }).code }
      }
    }
    const log = [await rodar(['status', '--porcelain']), await rodar(['add', '-A']), await rodar(['cherry-pick', lado])]
    expect(log.map((e) => e.exitCode)).toEqual([0, 0, 1])
    const inesperados = gitInesperado(log, { escreve: true })
    expect(inesperados).toHaveLength(1)
    expect(inesperados[0]).toContain('cherry-pick')
    expect(gitInesperado(log, { escreve: true, tolerado: [/^git cherry-pick /] })).toEqual([])
  })
})
