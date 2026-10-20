import type { FileDiff, LineKey } from './types'

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
