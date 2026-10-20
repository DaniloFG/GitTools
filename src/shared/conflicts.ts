// Leitura e montagem de arquivos com marcadores de conflito do git.

export type MergeChunk =
  | { kind: 'common'; lines: string[] }
  | { kind: 'conflict'; ours: string[]; base: string[] | null; theirs: string[]; oursLabel: string; theirsLabel: string }

export interface ParsedConflicts {
  chunks: MergeChunk[]
  eol: '\n' | '\r\n'
  /** O arquivo termina com quebra de linha. */
  finalNewline: boolean
}

export type ChunkResolution =
  | { kind: 'ours' }
  | { kind: 'theirs' }
  | { kind: 'base' }
  | { kind: 'ours-theirs' }
  | { kind: 'theirs-ours' }
  | { kind: 'custom'; text: string }

const START = /^<{7}(?: (.*))?$/
const BASE = /^\|{7}(?: .*)?$/
const SEP = /^={7}$/
const END = /^>{7}(?: (.*))?$/

export function parseConflicts(text: string): ParsedConflicts {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const finalNewline = text.endsWith('\n')
  const lines = text.split(/\r?\n/)
  if (finalNewline) lines.pop()

  const chunks: MergeChunk[] = []
  let common: string[] = []
  const flush = () => {
    if (common.length) chunks.push({ kind: 'common', lines: common })
    common = []
  }

  let i = 0
  while (i < lines.length) {
    const start = START.exec(lines[i])
    if (!start) {
      common.push(lines[i++])
      continue
    }
    // Procura o fim do bloco; se estiver malformado, trata como texto comum.
    let j = i + 1
    const ours: string[] = []
    let base: string[] | null = null
    const theirs: string[] = []
    let section: 'ours' | 'base' | 'theirs' = 'ours'
    let end: RegExpExecArray | null = null
    for (; j < lines.length; j++) {
      const line = lines[j]
      if (section === 'ours' && BASE.test(line)) {
        section = 'base'
        base = []
      } else if (section !== 'theirs' && SEP.test(line)) section = 'theirs'
      else if (section === 'theirs' && (end = END.exec(line))) break
      else if (section === 'ours') ours.push(line)
      else if (section === 'base') base!.push(line)
      else theirs.push(line)
    }
    if (!end) {
      common.push(lines[i++])
      continue
    }
    flush()
    chunks.push({ kind: 'conflict', ours, base, theirs, oursLabel: start[1] ?? 'atual', theirsLabel: end[1] ?? 'que entra' })
    i = j + 1
  }
  flush()
  return { chunks, eol, finalNewline }
}

export function conflictCount(parsed: ParsedConflicts): number {
  return parsed.chunks.filter((c) => c.kind === 'conflict').length
}

/** Linhas resultantes de um bloco em conflito, ou null se ainda não foi resolvido. */
export function resolveChunk(chunk: Extract<MergeChunk, { kind: 'conflict' }>, resolution: ChunkResolution | undefined): string[] | null {
  if (!resolution) return null
  switch (resolution.kind) {
    case 'ours':
      return chunk.ours
    case 'theirs':
      return chunk.theirs
    case 'base':
      return chunk.base ?? []
    case 'ours-theirs':
      return [...chunk.ours, ...chunk.theirs]
    case 'theirs-ours':
      return [...chunk.theirs, ...chunk.ours]
    case 'custom':
      return resolution.text === '' ? [] : resolution.text.split(/\r?\n/)
  }
}

/**
 * Monta o conteúdo final. Blocos sem resolução mantêm os marcadores originais,
 * então o arquivo nunca perde informação.
 */
export function buildResult(parsed: ParsedConflicts, resolutions: (ChunkResolution | undefined)[]): string {
  const out: string[] = []
  let n = 0
  for (const chunk of parsed.chunks) {
    if (chunk.kind === 'common') {
      out.push(...chunk.lines)
      continue
    }
    const resolved = resolveChunk(chunk, resolutions[n++])
    if (resolved) out.push(...resolved)
    else {
      out.push(`<<<<<<< ${chunk.oursLabel}`, ...chunk.ours)
      if (chunk.base) out.push('|||||||', ...chunk.base)
      out.push('=======', ...chunk.theirs, `>>>>>>> ${chunk.theirsLabel}`)
    }
  }
  if (out.length === 0) return ''
  return out.join(parsed.eol) + (parsed.finalNewline ? parsed.eol : '')
}
