// Tipos de orcamentos.mjs para o teste (tests/orcamentos.test.ts) e o typecheck.
export interface OrcamentoResponsivo {
  larguras: number[]
  posicoes: string[]
  altura: number
}
export interface OrcamentoDesempenho {
  cpu: number
  cenario: string
  tetos: Record<string, number>
}
export interface OrcamentoTeclado {
  tetos: Record<string, number>
}
export interface Orcamentos {
  origem: string
  responsivo: OrcamentoResponsivo
  desempenho: OrcamentoDesempenho
  teclado: OrcamentoTeclado
}

export function validarOrcamentos(obj: unknown): string[]
export function carregarOrcamentos(caminho?: string): Orcamentos
export function avaliarTetos(medido: Record<string, number>, tetos: Record<string, number>): string[]
