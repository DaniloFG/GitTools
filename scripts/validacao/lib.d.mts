// Tipos de lib.mjs para o teste (tests/validacao.test.ts) e o typecheck.
export const RAIZ: string
export const SAIDA: string
export const FASE_IGUAL: string

export interface FaseDefinida {
  nome: string
  comando: string[]
}
export const FASES: FaseDefinida[]

export interface Opcoes {
  keepGoing: boolean
  so: string | null
  igualA: string | null
  erro: string | null
}
export function parseArgs(argv: string[]): Opcoes
export function fasesDoPlano(opcoes: Pick<Opcoes, 'so' | 'igualA'>): { nome: string; comando?: string[] }[]
export function ultimasLinhas(texto: string, n?: number): string

export function arvoreDe(ref: string, cwd: string): string
export function compararArvores(refA: string, refB: string, cwd: string): { igual: boolean; arvoreA: string; arvoreB: string }
export function mesmaArvore(refA: string, refB: string, cwd: string): boolean

export interface ResultadoFase {
  nome: string
  ok: boolean
  ms: number
}
export interface Relatorio {
  commit: string
  arvore: string
  branch: string
  quando: string
  fases: ResultadoFase[]
  ok: boolean
}
export function montarRelatorio(dados: Omit<Relatorio, 'ok'>): Relatorio
export function formatarRelatorio(relatorio: Relatorio): string

export function classificarErros(erros: string[]): { reais: string[]; naoEncontrados: number; ok: boolean }
export interface RegrasGit {
  /** O cenário altera o repositório de propósito: só "saiu com código ≠ 0" reprova. */
  escreve?: boolean
  /** Chamadas (`git <args>`) fora da conta, por qualquer motivo. */
  tolerado?: RegExp[]
}
export function gitInesperado(log: { args: string[]; exitCode?: number }[], regras?: RegrasGit): string[]
