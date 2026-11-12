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
  /** Compara por valor (JSON) e reprova dizendo os dois lados. */
  igual(real: unknown, esperado: unknown, rotulo: string): void
  /** Espera `funcao(arg)` rodar verdadeira na página (até 10 s). */
  pagina<A>(funcao: (arg: A) => unknown, arg: A, rotulo: string): Promise<void>
  /** Espera `leitura()` devolver algo verdadeiro (até 10 s) e devolve esse valor. */
  ate<T>(leitura: () => Promise<T> | T, rotulo: string): Promise<NonNullable<T>>
}

export interface CenarioE2e {
  id: string
  tela: string
  area: string
  orcamento: Orcamento
  /** O cenário altera o repositório de propósito (o git de escrita não conta como inesperado; saída ≠ 0 conta). */
  escreve?: boolean
  /** Chamadas do git (`git <args>`) fora da conta de inesperados; último recurso, com o motivo em comentário. */
  gitTolerado?: RegExp[]
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
