// Largura escolhida pelo usuário para a coluna Graph do histórico (arrastando a borda do cabeçalho).
// Lógica pura, sem React: a tela só lê e grava o valor pelo layout.

/** Piso: uma trilha e o ponto cabem. É também o piso da largura automática. */
export const GRAPH_MIN_WIDTH = 52
/** Teto: largura bem acima de qualquer grafo comum; o usuário não arrasta a coluna para fora do painel. */
export const GRAPH_MAX_WIDTH = 1200

/**
 * Lê o valor gravado. Número finito vira largura (inteira, dentro do intervalo); qualquer outra coisa, inclusive
 * texto, NaN e Infinity, é "automática" (null). Assim um valor corrompido no disco volta ao padrão.
 */
export function parseGraphWidth(value: unknown): number | null {
  return Number.isFinite(value) ? clampGraphWidth(value as number) : null
}

/** Leva a largura para dentro do intervalo, em pixel inteiro (o SVG e a grade pedem inteiro). */
export function clampGraphWidth(width: number): number {
  return Math.min(GRAPH_MAX_WIDTH, Math.max(GRAPH_MIN_WIDTH, Math.round(width)))
}

/**
 * Largura que vale para o desenho. A preferência já chega levada para o intervalo (é o que `parseGraphWidth` devolve
 * ao ler o layout), e sem preferência (null) a automática passa sem mudança.
 */
export function resolveGraphWidth(auto: number, user: number | null): number {
  return user ?? auto
}
