// Largura escolhida pelo usuário para a coluna Graph do histórico (arrastando a borda do cabeçalho).
// Lógica pura, sem React: a tela só lê e grava o valor pelo layout.

/** Piso: uma trilha e o ponto cabem. É também o piso da largura automática. */
export const GRAPH_MIN_WIDTH = 52
/** Teto: largura bem acima de qualquer grafo comum; o usuário não arrasta a coluna para fora do painel. */
export const GRAPH_MAX_WIDTH = 1200

/**
 * Lê o valor gravado. Número finito vira largura (inteira, dentro do intervalo); qualquer outra coisa, inclusive
 * texto, NaN e Infinity, é "automática" (null). Assim um valor corrompido no disco volta ao padrão em vez de quebrar a coluna.
 */
export function parseGraphWidth(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return clampGraphWidth(value)
}

/**
 * Leva a largura para dentro do intervalo, em pixel inteiro (o SVG e a grade de colunas pedem inteiro).
 * NaN não tem posição: vai para o mínimo, que é o valor mais seguro para a coluna.
 */
export function clampGraphWidth(width: number): number {
  if (Number.isNaN(width)) return GRAPH_MIN_WIDTH
  return Math.min(GRAPH_MAX_WIDTH, Math.max(GRAPH_MIN_WIDTH, Math.round(width)))
}

/**
 * Largura que vale para o desenho. Sem preferência do usuário (null), a automática (a de sempre, que depende das
 * trilhas do histórico) passa sem mudança, para a saída ser idêntica à de antes da alça existir.
 */
export function resolveGraphWidth(auto: number, user: number | null): number {
  return user === null ? auto : clampGraphWidth(user)
}
