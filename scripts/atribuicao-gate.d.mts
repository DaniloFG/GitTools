// Tipos de atribuicao-gate.mjs para os testes (tests/atribuicaoGate.test.ts) e o typecheck.
export interface RegraAtribuicao {
  rule: string
  re: RegExp
}
export interface AchadoAtribuicao {
  line: number
  rule: string
}
export interface CommitDoPr {
  sha: string
  message: string
}

export const RULES: RegraAtribuicao[]
export function findAttribution(text: string, opcoes?: { corpoPR?: boolean }): AchadoAtribuicao[]
export function commitMessages(base: string, head: string, opcoes?: { cwd?: string }): Promise<CommitDoPr[]>
export function gateProblems(entrada: { commits: CommitDoPr[]; body: string }): string[]
