// Tipos de relatorio.mjs para o teste (tests/e2e-runner.test.ts) e o typecheck.

export interface Orcamento {
  ms: number
  nos: number
  erros: number
  git: number
}

/** O que um cenário recebe do runner para conferir a tela. */
export interface ExpectE2e {
  /** Espera por condição (até 10 s) até haver ao menos `minimo` elementos com o seletor. */
  visivel(seletor: string, minimo: number): Promise<void>
  /** Reprova com `mensagem` quando `condicao` é falsa. */
  verdadeiro(condicao: unknown, mensagem: string): void
}

export interface CenarioE2e {
  id: string
  tela: string
  area: string
  orcamento: Orcamento
  passos: (app: unknown, expect: ExpectE2e) => Promise<void>
}

export function validarCenario(c: unknown, jaVistos: ReadonlySet<string>): string[]

export function avaliarOrcamento(medido: Orcamento, orcamento: Orcamento): string[]

export interface ResultadoCenario {
  id: string
  tela: string
  area: string
  ms: number
  nos: number
  ok: boolean
  /** Motivos da falha separados por " | "; vazio quando ok. */
  motivo: string
}

export interface RelatorioE2e {
  quando: string
  ok: boolean
  total: number
  falhas: number
  cenarios: ResultadoCenario[]
}

export function montarRelatorioE2e(dados: { quando: string; cenarios: ResultadoCenario[] }): RelatorioE2e

export function gerarJunit(relatorio: RelatorioE2e): string
