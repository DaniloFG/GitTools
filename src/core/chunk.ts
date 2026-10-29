/**
 * Orçamento de caracteres para os argumentos variáveis (caminhos e shas) de um comando git.
 * O Windows aceita cerca de 32 KB na linha de comando inteira; o restante fica como folga.
 */
export const ARG_BUDGET = 6_000

/**
 * Tamanho máximo da linha de comando antes de o git sequer ser iniciado. Acima disso o sistema
 * recusaria o processo (E2BIG no Linux, ENOENT no Windows): é melhor falar o motivo antes.
 */
export const MAX_COMMAND_CHARS = 30_000

/** Custo de um argumento na linha de comando: o texto, mais aspas e espaço que o Windows pode acrescentar. */
const argCost = (arg: string) => arg.length + 3

/** Quantos caracteres os argumentos ocupam na linha de comando (estimativa conservadora). */
export function commandChars(args: readonly string[]): number {
  let total = 0
  for (const arg of args) total += argCost(arg)
  return total
}

/**
 * Divide itens em lotes que cabem no orçamento, mantendo a ordem. Um item maior que o orçamento
 * vai sozinho no próprio lote (o caminho dele ainda é aceito pelo sistema, se for válido).
 */
export function chunkArgs(items: readonly string[], budget = ARG_BUDGET): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let size = 0
  for (const item of items) {
    const cost = argCost(item)
    if (current.length && size + cost > budget) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(item)
    size += cost
  }
  if (current.length) chunks.push(current)
  return chunks
}
