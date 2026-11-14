// Tipos de changelog-gate.mjs para os testes (tests/changelogGate.test.ts) e o typecheck.
export interface RegraProibida {
  rule: string
  re: RegExp
}
export interface AchadoProibido {
  line: number
  rule: string
  match: string
}

export const RULES: RegraProibida[]
export function findForbidden(text: string, rules?: RegraProibida[]): AchadoProibido[]
export function sectionBody(changelog: string, titulo: string): string | null
export function releaseNotes(changelog: string, version: string): string
export function gateProblems(changelog: string, version: string, releaseBody: string): string[]
