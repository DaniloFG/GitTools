// Linhas da tela Conflitos: o tipo de cada conflito sai do XY que o `status` já traz (linha `u` em
// src/core/repository.ts), então não há processo git extra. Lógica pura, sem React, para ser testada direto
// (tests/conflict-rows.test.ts).

import type { FileStatus } from '../../shared/types'
import type { Decisions, RememberedSide } from './conflictFlow'

/** Tipo do conflito, pelo par XY do porcelain v2 (`u`). */
export type ConflictKind = 'bothModified' | 'bothAdded' | 'bothDeleted' | 'addedByUs' | 'addedByThem' | 'deletedByUs' | 'deletedByThem'

/** Os sete pares que o git grava numa linha `u`. Qualquer outro par não é conflito. */
const KINDS: ReadonlyMap<string, ConflictKind> = new Map([
  ['UU', 'bothModified'],
  ['AA', 'bothAdded'],
  ['DD', 'bothDeleted'],
  ['AU', 'addedByUs'],
  ['UA', 'addedByThem'],
  ['DU', 'deletedByUs'],
  ['UD', 'deletedByThem']
])

/**
 * Tipo do conflito a partir dos códigos X (índice) e Y (árvore de trabalho). Outro par (um arquivo modificado,
 * sem conflito, por exemplo `M` + ` `) devolve null e a linha é descartada. Os códigos têm um caractere cada: a
 * conferência de tamanho impede que `'UU'` + `''` case com `UU` por concatenação.
 */
export function conflictKind(index: string, worktree: string): ConflictKind | null {
  if (index.length !== 1 || worktree.length !== 1) return null
  return KINDS.get(index + worktree) ?? null
}

export interface ConflictRow {
  path: string
  kind: ConflictKind
  /**
   * Lado escolhido e lembrado (`decisions`). null = sem decisão. Arquivo resolvido sai de `status.conflicted`,
   * então "pendente" aqui quer dizer: ainda em conflito e sem decisão lembrada.
   */
  resolved: RememberedSide | null
}

/**
 * Uma linha por arquivo em conflito, na ordem do `status`. Arquivo sem tipo de conflito é descartado. A decisão é
 * consultada por caminho num Map, então o custo é linear no número de arquivos.
 */
export function buildConflictRows(files: readonly FileStatus[], decisions: Decisions): ConflictRow[] {
  const rows: ConflictRow[] = []
  for (const file of files) {
    const kind = conflictKind(file.index, file.worktree)
    if (!kind) continue
    rows.push({ path: file.path, kind, resolved: decisions.get(file.path) ?? null })
  }
  return rows
}

/**
 * Próximo arquivo pendente (resolved === null) a partir do atual, para o atalho "próximo pendente".
 * Sem pendentes, null. Atual no último: volta ao começo da lista (e fica no próprio atual se ele for o único
 * pendente). Atual fora da lista (ou null): o primeiro pendente.
 */
export function nextPending(rows: readonly ConflictRow[], currentPath: string | null): string | null {
  const at = currentPath === null ? -1 : rows.findIndex((row) => row.path === currentPath)
  if (at === -1) return rows.find((row) => row.resolved === null)?.path ?? null
  for (let i = at + 1; i < rows.length; i++) {
    if (rows[i].resolved === null) return rows[i].path
  }
  // Volta ao começo; vai até o próprio atual, inclusive, para que ele seja escolhido se for o único pendente.
  for (let i = 0; i <= at; i++) {
    if (rows[i].resolved === null) return rows[i].path
  }
  return null
}

/**
 * Seleção que ainda vale: o arquivo escolhido sai de `status.conflicted` quando é resolvido (ou quando a operação
 * termina), e o painel do editor não pode ficar apontando para um arquivo que já não está em conflito. Fora das
 * linhas (ou sem seleção), null. Linear no número de linhas; quem chama a guarda num `useMemo`.
 */
export function keepSelection(rows: readonly ConflictRow[], selected: string | null): string | null {
  if (selected === null) return null
  return rows.some((row) => row.path === selected) ? selected : null
}

/** Aba visível na janela estreita (< 640px): lista ou editor. Em janela larga as duas aparecem juntas. */
export type ConflictTab = 'list' | 'editor'

/**
 * Aba que de fato aparece. A aba "Editor" sem arquivo selecionado não teria o que mostrar (por exemplo, logo depois
 * de resolver o arquivo), então a lista volta sozinha.
 */
export function effectiveTab(selected: string | null, tab: ConflictTab): ConflictTab {
  return selected === null ? 'list' : tab
}
