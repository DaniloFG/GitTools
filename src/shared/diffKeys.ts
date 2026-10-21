import type { DiffHunk, FileDiff, LineKey } from './types'

export function lineKey(hunkIndex: number, lineIndex: number): LineKey {
  return `${hunkIndex}:${lineIndex}`
}

/** Todas as chaves de linhas alteradas (+/-) de um arquivo. */
export function changeKeys(file: FileDiff): LineKey[] {
  const keys: LineKey[] = []
  file.hunks.forEach((hunk, h) =>
    hunk.lines.forEach((line, l) => {
      if (line.kind !== 'context') keys.push(lineKey(h, l))
    })
  )
  return keys
}

/** Chaves das linhas alteradas de um único hunk. */
export function hunkKeys(file: FileDiff, hunkIndex: number): LineKey[] {
  const keys: LineKey[] = []
  file.hunks[hunkIndex]?.lines.forEach((line, l) => {
    if (line.kind !== 'context') keys.push(lineKey(hunkIndex, l))
  })
  return keys
}

/** Linha da visão lado a lado: à esquerda a versão antiga, à direita a nova (índices em `hunk.lines`). */
export interface SplitRow {
  left: number | null
  right: number | null
}

/**
 * Monta as linhas lado a lado de um hunk: o contexto aparece dos dois lados, e cada sequência de
 * remoções fica emparelhada com as adições que vêm logo depois (a sobra fica com o outro lado vazio).
 */
export function splitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = []
  const lines = hunk.lines
  let i = 0
  while (i < lines.length) {
    if (lines[i].kind === 'context') {
      rows.push({ left: i, right: i })
      i++
      continue
    }
    const dels: number[] = []
    const adds: number[] = []
    while (i < lines.length && lines[i].kind === 'del') dels.push(i++)
    while (i < lines.length && lines[i].kind === 'add') adds.push(i++)
    for (let n = 0; n < Math.max(dels.length, adds.length); n++) rows.push({ left: dels[n] ?? null, right: adds[n] ?? null })
  }
  return rows
}
