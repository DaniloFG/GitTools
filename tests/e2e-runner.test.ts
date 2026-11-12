import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { avaliarOrcamento, gerarJunit, montarRelatorioE2e, validarCenario } from '../scripts/validacao/e2e/relatorio.mjs'

const PASTA_CENARIOS = fileURLToPath(new URL('../scripts/validacao/e2e/cenarios/', import.meta.url))
const ORCAMENTO = { ms: 15000, nos: 5000, erros: 0, git: 0 }
const QUANDO = '2026-01-02T03:04:05.000Z'

/** Um cenário válido; `extra` sobrescreve campos (undefined simula campo ausente). */
function cenario(extra: Record<string, unknown> = {}) {
  return { id: 'historico', tela: 'History', area: 'historico', orcamento: ORCAMENTO, passos: async () => undefined, ...extra }
}

describe('validarCenario', () => {
  it('aceita um cenário completo', () => {
    expect(validarCenario(cenario(), new Set())).toEqual([])
  })

  it('reprova id, tela, área, passos e orçamento ausentes', () => {
    expect(validarCenario(cenario({ id: undefined }), new Set())).toEqual(['id ausente'])
    expect(validarCenario(cenario({ tela: undefined }), new Set())).toEqual(['"historico": tela ausente'])
    expect(validarCenario(cenario({ area: undefined }), new Set())).toEqual(['"historico": area ausente'])
    expect(validarCenario(cenario({ passos: undefined }), new Set())).toEqual(['"historico": passos ausentes'])
    expect(validarCenario(cenario({ orcamento: undefined }), new Set())).toEqual(['"historico": orçamento ausente'])
  })

  it('reprova orçamento incompleto, negativo ou não numérico', () => {
    expect(validarCenario(cenario({ orcamento: { ms: 1, nos: 1, erros: 0 } }), new Set())).toEqual(['"historico": orçamento.git ausente ou inválido'])
    expect(validarCenario(cenario({ orcamento: { ...ORCAMENTO, ms: -1 } }), new Set())).toEqual(['"historico": orçamento.ms ausente ou inválido'])
    expect(validarCenario(cenario({ orcamento: { ...ORCAMENTO, nos: '5000' } }), new Set())).toEqual(['"historico": orçamento.nos ausente ou inválido'])
  })

  it('reprova id já usado por outro cenário', () => {
    expect(validarCenario(cenario(), new Set(['historico']))).toEqual(['id duplicado: "historico"'])
  })

  it('reprova id que não pode virar nome de arquivo', () => {
    for (const id of ['Histórico', '../x', 'a b', '-inicio', '']) {
      const erros = validarCenario(cenario({ id }), new Set())
      expect(erros.length).toBeGreaterThan(0)
    }
    expect(validarCenario(cenario({ id: 'git-log-2' }), new Set())).toEqual([])
  })

  it('acumula os problemas e recusa o que não é objeto', () => {
    expect(validarCenario(cenario({ id: undefined, passos: undefined }), new Set())).toHaveLength(2)
    expect(validarCenario(null, new Set())).toEqual(['o cenário não é um objeto'])
    expect(validarCenario('historico', new Set())).toEqual(['o cenário não é um objeto'])
  })
})

describe('avaliarOrcamento', () => {
  it('passa dentro do orçamento e no limite exato', () => {
    expect(avaliarOrcamento({ ms: 100, nos: 10, erros: 0, git: 0 }, ORCAMENTO)).toEqual([])
    expect(avaliarOrcamento({ ms: 15000, nos: 5000, erros: 0, git: 0 }, ORCAMENTO)).toEqual([])
  })

  it('reprova cada violação, uma por campo', () => {
    expect(avaliarOrcamento({ ms: 15001, nos: 0, erros: 0, git: 0 }, ORCAMENTO)).toEqual(['tempo (ms): 15001 acima do orçamento de 15000'])
    expect(avaliarOrcamento({ ms: 0, nos: 5001, erros: 0, git: 0 }, ORCAMENTO)).toEqual(['nós no DOM: 5001 acima do orçamento de 5000'])
    expect(avaliarOrcamento({ ms: 0, nos: 0, erros: 1, git: 0 }, ORCAMENTO)).toEqual(['erros de página: 1 acima do orçamento de 0'])
    expect(avaliarOrcamento({ ms: 0, nos: 0, erros: 0, git: 1 }, ORCAMENTO)).toEqual(['processos git inesperados: 1 acima do orçamento de 0'])
  })

  it('acumula todas as violações', () => {
    expect(avaliarOrcamento({ ms: 15001, nos: 5001, erros: 1, git: 1 }, ORCAMENTO)).toHaveLength(4)
  })
})

describe('montarRelatorioE2e', () => {
  const ok = { id: 'history', tela: 'History', area: 'historico', ms: 1200, nos: 300, ok: true, motivo: '' }
  const falha = { id: 'files', tela: 'Files', area: 'arquivos', ms: 900, nos: 200, ok: false, motivo: 'esperava ao menos 1 de ".file-item", achou 0' }

  it('sem nenhum cenário não é ok', () => {
    expect(montarRelatorioE2e({ quando: QUANDO, cenarios: [] })).toMatchObject({ ok: false, total: 0, falhas: 0 })
  })

  it('é ok quando todos passam, e não é ok com uma falha', () => {
    expect(montarRelatorioE2e({ quando: QUANDO, cenarios: [ok, ok] })).toMatchObject({ ok: true, total: 2, falhas: 0 })
    expect(montarRelatorioE2e({ quando: QUANDO, cenarios: [ok, falha] })).toMatchObject({ ok: false, total: 2, falhas: 1 })
  })

  it('o JSON é estável: mesma ordem de chaves e só os campos do relatório', () => {
    const comExtra = { ...ok, detalhe: 'não entra no relatório' }
    const rel = montarRelatorioE2e({ quando: QUANDO, cenarios: [comExtra] })
    expect(Object.keys(rel)).toEqual(['quando', 'ok', 'total', 'falhas', 'cenarios'])
    expect(Object.keys(rel.cenarios[0])).toEqual(['id', 'tela', 'area', 'ms', 'nos', 'ok', 'motivo'])
    expect(JSON.stringify(montarRelatorioE2e({ quando: QUANDO, cenarios: [ok, falha] }))).toBe(JSON.stringify(montarRelatorioE2e({ quando: QUANDO, cenarios: [ok, falha] })))
  })
})

describe('gerarJunit', () => {
  it('um testcase por cenário, com tempo em segundos e a contagem de falhas', () => {
    const rel = montarRelatorioE2e({
      quando: QUANDO,
      cenarios: [
        { id: 'history', tela: 'History', area: 'historico', ms: 1500, nos: 10, ok: true, motivo: '' },
        { id: 'files', tela: 'Files', area: 'arquivos', ms: 250, nos: 10, ok: false, motivo: 'erro' }
      ]
    })
    const xml = gerarJunit(rel)
    expect(xml).toContain('<testsuite name="e2e" tests="2" failures="1" time="1.750">')
    expect(xml).toContain('<testcase classname="History" name="history" time="1.500"/>')
    expect(xml).toContain('<testcase classname="Files" name="files" time="0.250">')
    expect(xml).toContain('<failure message="erro">erro</failure>')
    expect(xml.split('<failure ').length - 1).toBe(1)
  })

  it('escapa & < > " \' nos atributos e no texto, e troca caractere de controle', () => {
    const motivo = `a & b < c > "d" 'e' x\u0001y`
    const rel = montarRelatorioE2e({
      quando: QUANDO,
      cenarios: [{ id: 'files', tela: 'Git & log', area: 'git', ms: 1, nos: 1, ok: false, motivo }]
    })
    const xml = gerarJunit(rel)
    const escapado = 'a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos; x?y'
    expect(xml).toContain(`<failure message="${escapado}">${escapado}</failure>`)
    expect(xml).toContain('classname="Git &amp; log"')
    expect(xml).not.toContain('< c')
    expect(xml).not.toContain('\u0001')
  })

  it('sem cenários gera um testsuite vazio e sem falhas', () => {
    expect(gerarJunit(montarRelatorioE2e({ quando: QUANDO, cenarios: [] }))).toContain('<testsuite name="e2e" tests="0" failures="0" time="0.000">')
  })
})

describe('cenários do roteiro', () => {
  // A mesma cobertura de antes da mudança: aba clicada, seletor e mínimo de cada tela.
  const ESPERADO: Record<string, { clique: string; visivel: [string, number] }> = {
    history: { clique: '.screen-tab:not(.dashboards-tab):History', visivel: ['.commit-row', 5] },
    changes: { clique: '.screen-tab:not(.dashboards-tab):Changes', visivel: ['.file-item', 1] },
    files: { clique: '.screen-tab:not(.dashboards-tab):Files', visivel: ['.file-item', 1] },
    compare: { clique: '.screen-tab:not(.dashboards-tab):Compare', visivel: ['.file-item', 1] },
    branches: { clique: '.screen-tab:not(.dashboards-tab):Branches', visivel: ['.branch-item', 2] },
    gitlog: { clique: '.screen-tab:not(.dashboards-tab):Git log', visivel: ['.gitlog-command', 1] },
    dashboard: { clique: '.dashboards-tab', visivel: ['.dash-grid > *', 1] }
  }

  /** Página falsa: registra o seletor e o texto de cada clique, sem navegador. */
  function paginaFalsa(cliques: string[]) {
    const localizar = (seletor: string, texto?: string) => ({
      first: () => localizar(seletor, texto),
      filter: (opcoes: { hasText: string }) => localizar(seletor, opcoes.hasText),
      click: async () => {
        cliques.push(texto === undefined ? seletor : `${seletor}:${texto}`)
      }
    })
    return { locator: (seletor: string) => localizar(seletor) }
  }

  it('são sete, com ids únicos, e cada um passa na validação', async () => {
    const arquivos = readdirSync(PASTA_CENARIOS).filter((f) => f.endsWith('.mjs')).sort()
    expect(arquivos.map((f) => f.replace(/\.mjs$/, ''))).toEqual(Object.keys(ESPERADO).sort())
    const vistos = new Set<string>()
    for (const arquivo of arquivos) {
      const modulo = await import(pathToFileURL(join(PASTA_CENARIOS, arquivo)).href)
      expect(validarCenario(modulo.default, vistos)).toEqual([])
      vistos.add(modulo.default.id)
    }
  })

  it('cada cenário clica a aba certa, espera o seletor e o mínimo de antes, e tem o orçamento padrão', async () => {
    const arquivos = readdirSync(PASTA_CENARIOS).filter((f) => f.endsWith('.mjs')).sort()
    for (const arquivo of arquivos) {
      const modulo = await import(pathToFileURL(join(PASTA_CENARIOS, arquivo)).href)
      const c = modulo.default
      const esperado = ESPERADO[c.id]
      expect(esperado, `cenário ${c.id}`).toBeDefined()
      const cliques: string[] = []
      const visiveis: [string, number][] = []
      const esperar = {
        visivel: async (seletor: string, minimo: number) => {
          visiveis.push([seletor, minimo])
        },
        verdadeiro: (condicao: unknown, mensagem: string) => {
          if (!condicao) throw new Error(mensagem)
        }
      }
      await c.passos({ page: paginaFalsa(cliques) }, esperar)
      expect(cliques, `cliques de ${c.id}`).toEqual([esperado.clique])
      expect(visiveis, `esperas de ${c.id}`).toEqual([esperado.visivel])
      expect(c.orcamento).toEqual(ORCAMENTO)
    }
  })
})
