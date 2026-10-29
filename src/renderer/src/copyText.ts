// Texto copiado das telas, sem a interface: monta o que vai para a área de transferência.

import { lineKey } from '../../shared/diffKeys'
import type { DiffLine, FileDiff, LineKey } from '../../shared/types'

/**
 * Texto de linhas de diff para copiar: só o código, uma linha por linha, sem os números de linha nem o
 * sinal (+, −, espaço) de cada uma.
 */
export function diffLinesText(lines: readonly Pick<DiffLine, 'content'>[]): string {
  return lines.map((line) => line.content).join('\n')
}

/** Linhas marcadas (na ordem em que aparecem no diff), para copiar o que foi escolhido na seleção. */
export function markedDiffLines(file: Pick<FileDiff, 'hunks'>, marked: ReadonlySet<LineKey>): DiffLine[] {
  return file.hunks.flatMap((hunk, h) => hunk.lines.filter((_, l) => marked.has(lineKey(h, l))))
}
