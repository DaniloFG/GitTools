// Tipos de cobertura.mjs para o teste (tests/gate-cobertura.test.ts) e o typecheck.
export const TELA_POR_ID: Readonly<Record<string, string>>
export function lerIdsDeTelas(texto: string): string[]
export function telasSemCenario(ids: readonly string[], telasDosCenarios: Iterable<string>): string[]
export interface PRParaAvaliar {
  arquivos: readonly string[]
  rotulos: readonly string[]
  corpo: string | null
}
export interface Veredito {
  ok: boolean
  motivo: string
}
export function avaliarPR(pr: PRParaAvaliar): Veredito
export function lerTelasDosCenarios(pasta?: string): Promise<Set<string>>
