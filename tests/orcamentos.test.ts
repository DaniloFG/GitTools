import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { avaliarTetos, carregarOrcamentos, validarOrcamentos } from '../scripts/validacao/orcamentos.mjs'
import type { Orcamentos } from '../scripts/validacao/orcamentos.mjs'

/** Cópia profunda do arquivo real, para cada teste estragar o seu pedaço sem afetar os outros. */
const real = (): Orcamentos => structuredClone(carregarOrcamentos())

describe('carregarOrcamentos', () => {
  it('lê o orcamentos.json real e ele é válido', () => {
    const o = carregarOrcamentos()
    expect(o.origem).toBe('docs/PERFORMANCE.md, seção 7')
    expect(validarOrcamentos(o)).toEqual([])
    expect(o.responsivo.larguras).toEqual([320, 480, 640, 1024, 1440])
    expect(o.responsivo.posicoes).toEqual(['esquerda', 'direita', 'embaixo'])
    expect(o.desempenho.tetos.gitStage).toBe(9)
    // Acessibilidade corrigida (#120): os tetos do teclado ficam em 0; nunca subir sem motivo no commit.
    expect(o.teclado.tetos).toEqual({ semNomeAcessivel: 0, semFocoVisivel: 0 })
  })

  it('lança com a lista de problemas quando o arquivo é inválido', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'orcamentos-'))
    try {
      const ruim = real()
      ruim.desempenho.tetos.gitStage = -1
      const caminho = join(pasta, 'ruim.json')
      writeFileSync(caminho, JSON.stringify(ruim))
      expect(() => carregarOrcamentos(caminho)).toThrow(/desempenho\.tetos\.gitStage: ausente ou inválido/)
      writeFileSync(caminho, '{ não é json')
      expect(() => carregarOrcamentos(caminho)).toThrow(/não leu/)
      expect(() => carregarOrcamentos(join(pasta, 'nao-existe.json'))).toThrow(/não leu/)
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  })
})

describe('validarOrcamentos', () => {
  it('reprova teto negativo, NaN, texto e ausente', () => {
    const o = real()
    o.desempenho.tetos.gitFoco = -1
    o.desempenho.tetos.nosDom = Number.NaN
    // O JSON nunca traz NaN, mas o objeto vem de qualquer lugar; texto e ausente são os casos do arquivo.
    ;(o.teclado.tetos as Record<string, unknown>).semNomeAcessivel = '0'
    delete (o.desempenho.tetos as Record<string, unknown>).gitStage
    const problemas = validarOrcamentos(o)
    expect(problemas).toContain('desempenho.tetos.gitFoco: ausente ou inválido')
    expect(problemas).toContain('desempenho.tetos.nosDom: ausente ou inválido')
    expect(problemas).toContain('teclado.tetos.semNomeAcessivel: ausente ou inválido')
    // Teto removido do arquivo não gera erro aqui: quem pega é avaliarTetos (teto sem medida / medido sem teto).
    expect(problemas).toHaveLength(3)
  })

  it('reprova grupo ausente, origem vazia e larguras inválidas', () => {
    expect(validarOrcamentos(null)).toEqual(['orçamentos: o arquivo não é um objeto'])
    expect(validarOrcamentos([])).toEqual(['orçamentos: o arquivo não é um objeto'])
    expect(validarOrcamentos({})).toEqual(['origem ausente', 'responsivo ausente', 'desempenho ausente', 'teclado ausente'])
    const o = real()
    o.origem = ' '
    o.responsivo.larguras = [320, 0]
    o.responsivo.posicoes = []
    o.desempenho.cpu = 0
    o.teclado.tetos = {}
    expect(validarOrcamentos(o)).toEqual([
      'origem ausente',
      'responsivo.larguras: ausente ou inválido',
      'responsivo.posicoes: ausente ou inválido',
      'desempenho.cpu: ausente ou inválido',
      'teclado.tetos: tetos ausentes'
    ])
  })
})

describe('avaliarTetos', () => {
  const tetos = { gitStage: 9, nosDom: 5000 }

  it('passa dentro do teto e no limite exato', () => {
    expect(avaliarTetos({ gitStage: 3, nosDom: 1200 }, tetos)).toEqual([])
    expect(avaliarTetos({ gitStage: 9, nosDom: 5000 }, tetos)).toEqual([])
    expect(avaliarTetos({ gitStage: 0, nosDom: 0 }, tetos)).toEqual([])
  })

  it('reprova acima do teto (limite mais um) com uma frase por violação', () => {
    expect(avaliarTetos({ gitStage: 10, nosDom: 5000 }, tetos)).toEqual(['gitStage: 10 acima do teto de 9'])
    expect(avaliarTetos({ gitStage: 10, nosDom: 5001 }, tetos)).toEqual(['gitStage: 10 acima do teto de 9', 'nosDom: 5001 acima do teto de 5000'])
  })

  it('reprova chave medida sem teto e teto sem medida', () => {
    expect(avaliarTetos({ gitStage: 1, nosDom: 1, novo: 1 }, tetos)).toEqual(['novo: medido sem teto'])
    expect(avaliarTetos({ gitStage: 1 }, tetos)).toEqual(['nosDom: teto sem medida'])
    expect(avaliarTetos({}, tetos)).toHaveLength(2)
  })

  it('chave herdada de Object.prototype não conta como teto nem como medida', () => {
    expect(avaliarTetos({ gitStage: 1, nosDom: 1, constructor: 1 }, tetos)).toEqual(['constructor: medido sem teto'])
    expect(avaliarTetos({ gitStage: 1, nosDom: 1 }, { ...tetos, toString: 1 })).toEqual(['toString: teto sem medida'])
  })

  it('reprova medida que não é número', () => {
    expect(avaliarTetos({ gitStage: Number.NaN, nosDom: 1 }, tetos)).toEqual(['gitStage: medido inválido (NaN)'])
  })

  it('um teto propositalmente baixo reprova o medido de hoje', () => {
    const o = real()
    // "Hoje" da seção 7 do PERFORMANCE.md: stage de 1 arquivo abre 9 processos.
    const hoje = { ...o.desempenho.tetos, gitStage: 9 }
    expect(avaliarTetos(hoje, o.desempenho.tetos)).toEqual([])
    o.desempenho.tetos.gitStage = 0
    expect(avaliarTetos(hoje, o.desempenho.tetos)).toEqual(['gitStage: 9 acima do teto de 0'])
  })
})
