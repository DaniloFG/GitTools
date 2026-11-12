// Filtro da lista de conflitos: por tipo, por situação (pendente ou decidido) e por busca no caminho. Lógica pura,
// sem React, para ser testada direto (tests/conflict-filter.test.ts).

import type { ConflictKind, ConflictRow } from './conflictRows'

/** Situação: `pending` = sem decisão lembrada; `decided` = com decisão. */
export type ConflictSituation = 'all' | 'pending' | 'decided'

export interface ConflictFilter {
  kind: ConflictKind | 'all'
  situation: ConflictSituation
  query: string
}

/**
 * Forma de comparação sem diferença de maiúsculas nem de acento: "Ação" vira "acao". NFD separa a letra do acento
 * e \p{M} remove as marcas. Aplicada à consulta uma vez e a cada caminho, nunca por caractere.
 */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * Linhas que passam pelo filtro, na mesma ordem. Sem nenhum filtro ativo, devolve a mesma referência do array
 * (quem renderiza não redesenha à toa). Espaços nas pontas da busca não contam: "a " é igual a "a".
 */
export function filterConflictRows(rows: readonly ConflictRow[], filter: ConflictFilter): readonly ConflictRow[] {
  const needle = fold(filter.query.trim())
  const active = filter.kind !== 'all' || filter.situation !== 'all' || needle !== ''
  if (!active) return rows
  return rows.filter((row) => {
    if (filter.kind !== 'all' && row.kind !== filter.kind) return false
    if (filter.situation === 'pending' && row.resolved !== null) return false
    if (filter.situation === 'decided' && row.resolved === null) return false
    // Busca no caminho inteiro, o que a lista mostra: acha também pelo diretório.
    return needle === '' || fold(row.path).includes(needle)
  })
}
