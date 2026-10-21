// Aritmética de posição em listas circulares (sem dependências do navegador, para os testes).

/** Posição seguinte numa lista circular de `count` itens; `current` = -1 antes de começar. */
export function stepIndex(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return -1
  if (current < 0) return delta === 1 ? 0 : count - 1
  return (current + delta + count) % count
}
