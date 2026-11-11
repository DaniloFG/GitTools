// Fila com poucas tarefas por vez. Um `Promise.all` direto sobre uma lista do usuário abriria um processo
// git por item ao mesmo tempo (dezenas, num workspace grande), disputando CPU e disco com a própria
// interface; uma por vez deixa tudo em série. Aqui ficam no máximo `limit` em andamento.

/**
 * Aplica `fn` a cada item com no máximo `limit` chamadas em andamento ao mesmo tempo. O resultado sai na
 * ordem da lista, qualquer que seja a ordem em que as chamadas terminam. Se uma chamada falha, a promessa
 * devolvida falha com o mesmo erro (quem quer seguir adiante trata o erro dentro de `fn`).
 */
export async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  // Cada "trabalhador" pega o próximo índice livre até a lista acabar; o pegar é síncrono, então dois
  // trabalhadores nunca ficam com o mesmo item.
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index], index)
    }
  }
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  await Promise.all(Array.from({ length: workers }, worker))
  return results
}
