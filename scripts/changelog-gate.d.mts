// Tipos de changelog-gate.mjs para os testes (tests/changelogGate.test.ts) e o typecheck.
export interface RegraProibida {
  rule: string
  re: RegExp
  /** Roda antes de os caracteres invisíveis serem removidos (só a regra `invisivel`). */
  cru?: boolean
}
export interface AchadoProibido {
  line: number
  rule: string
  match: string
}
export interface TextoDeArquivo {
  where: string | null
  text: string
}

export const RULES: RegraProibida[]
export const EXCECOES: { frase: string; onde: string }[]
export const NEUTRAL_NOTE: string
export function findForbidden(text: string, rules?: RegraProibida[]): AchadoProibido[]
export function sectionBody(changelog: string, titulo: string): string | null
export function releaseNotes(changelog: string, version: string, opcoes?: { neutro?: boolean }): string
export function gateProblems(changelog: string, version: string, releaseBody: string): string[]
export function textsOfFile(arquivo: string, conteudo: string): TextoDeArquivo[]
export function scanTextFiles(
  arquivos: string[],
  opcoes?: { version?: string; ler?: (caminho: string) => string },
): string[]
