// Formato compacto do diff no transporte entre o backend e a interface (Fase 3 de docs/PERFORMANCE.md).
//
// Por que: um diff de 5.000 linhas alteradas virava cerca de 25 mil objetos `{ kind, content, oldLine, newLine }`,
// com as mesmas chaves repetidas em cada linha. Gastava-se mais tempo com a forma (serializar, copiar pelo IPC,
// criar os objetos) do que com o texto. No transporte, cada hunk manda um caractere por linha (`kinds`), o texto
// de cada linha (`text`) e a lista das linhas sem quebra final (`nn`).
//
// Os números de linha não são enviados. O parseDiff os define por uma regra simples: começam em oldStart/newStart
// e avançam conforme o tipo de cada linha. `numberLines` repete essa mesma regra no decode. Se algum hunk não
// reproduzir os números exatos, o encode manda `ol`/`nl` só nesse hunk: nunca erra, só custa mais bytes.
//
// Este módulo não depende de Node nem do navegador: é usado pelo backend (encode) e pela interface (decode).

import type { DiffHunk, DiffLine, FileDiff, LineKind } from './types'

/** Marca o formato de transporte. Um FileDiff comum não tem `w`, então quem recebe distingue os dois. */
export const WIRE_VERSION = 1

export interface WireHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  section: string
  /** Um caractere por linha: ' ' contexto, '+' adição, '-' remoção. */
  kinds: string
  /** Conteúdo de cada linha; o índice é o mesmo de `kinds`. */
  text: string[]
  /** Índices das linhas com `noNewline`. Ausente quando nenhuma linha tem. */
  nn?: number[]
  /** Números de linha exatos, só para um hunk que a regra de recálculo não reproduz (não acontece com o git). */
  ol?: (number | null)[]
  nl?: (number | null)[]
}

export type WireFileDiff = Omit<FileDiff, 'hunks'> & { w: typeof WIRE_VERSION; hunks: WireHunk[] }

const KIND_CHAR: Record<LineKind, string> = { context: ' ', add: '+', del: '-' }
const CHAR_KIND: Record<string, LineKind | undefined> = { ' ': 'context', '+': 'add', '-': 'del' }

/**
 * Números de linha de um hunk, do mesmo jeito que o parseDiff os define: contexto e remoção avançam a numeração
 * antiga; contexto e adição avançam a nova. Adição não tem número antigo; remoção não tem número novo.
 */
function numberLines(kinds: string, oldStart: number, newStart: number): { oldLine: (number | null)[]; newLine: (number | null)[] } {
  const oldLine: (number | null)[] = new Array(kinds.length)
  const newLine: (number | null)[] = new Array(kinds.length)
  let oldNo = oldStart
  let newNo = newStart
  for (let i = 0; i < kinds.length; i++) {
    const c = kinds[i]
    if (c === ' ') {
      oldLine[i] = oldNo++
      newLine[i] = newNo++
    } else if (c === '-') {
      oldLine[i] = oldNo++
      newLine[i] = null
    } else {
      oldLine[i] = null
      newLine[i] = newNo++
    }
  }
  return { oldLine, newLine }
}

function encodeHunk(hunk: DiffHunk): WireHunk {
  const { lines } = hunk
  const kinds: string[] = new Array(lines.length)
  const text: string[] = new Array(lines.length)
  let nn: number[] | undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    kinds[i] = KIND_CHAR[line.kind]
    text[i] = line.content
    // Só marca quando é verdade: o parseDiff também não põe a chave nas outras linhas.
    if (line.noNewline) (nn ??= []).push(i)
  }
  const kindString = kinds.join('')
  const wire: WireHunk = {
    oldStart: hunk.oldStart,
    oldCount: hunk.oldCount,
    newStart: hunk.newStart,
    newCount: hunk.newCount,
    section: hunk.section,
    kinds: kindString,
    text
  }
  if (nn) wire.nn = nn
  const expected = numberLines(kindString, hunk.oldStart, hunk.newStart)
  const exact = lines.every((line, i) => line.oldLine === expected.oldLine[i] && line.newLine === expected.newLine[i])
  if (!exact) {
    wire.ol = lines.map((line) => line.oldLine)
    wire.nl = lines.map((line) => line.newLine)
  }
  return wire
}

function decodeHunk(wire: WireHunk): DiffHunk {
  const { kinds, text } = wire
  if (text.length !== kinds.length) throw new Error('diffWire: texto e tipos de linha não batem')
  const numbers = wire.ol && wire.nl ? { oldLine: wire.ol, newLine: wire.nl } : numberLines(kinds, wire.oldStart, wire.newStart)
  const lines: DiffLine[] = new Array(kinds.length)
  for (let i = 0; i < kinds.length; i++) {
    const kind = CHAR_KIND[kinds[i]]
    if (!kind) throw new Error(`diffWire: tipo de linha desconhecido "${kinds[i]}"`)
    lines[i] = { kind, content: text[i], oldLine: numbers.oldLine[i], newLine: numbers.newLine[i] }
  }
  if (wire.nn) for (const i of wire.nn) lines[i].noNewline = true
  return { oldStart: wire.oldStart, oldCount: wire.oldCount, newStart: wire.newStart, newCount: wire.newCount, section: wire.section, lines }
}

function encodeFile(file: FileDiff): WireFileDiff {
  const { hunks, ...rest } = file
  return { ...rest, w: WIRE_VERSION, hunks: hunks.map(encodeHunk) }
}

function decodeFile(file: WireFileDiff): FileDiff {
  const { w: _version, hunks, ...rest } = file
  return { ...rest, hunks: hunks.map(decodeHunk) }
}

/** Converte FileDiff[] para o formato de transporte. Campos do arquivo (caminhos, contagens, truncated...) passam como estão. */
export function encodeDiffs(files: FileDiff[]): WireFileDiff[] {
  return files.map(encodeFile)
}

/** Volta o formato de transporte para FileDiff[], igual ao que o parseDiff produziu. */
export function decodeDiffs(wire: WireFileDiff[]): FileDiff[] {
  return wire.map(decodeFile)
}

/**
 * Diz se a resposta veio no formato de transporte. Uma lista vazia conta como tal: decodificar [] dá [] de novo.
 */
export function isWireDiffs(value: unknown): value is WireFileDiff[] {
  return Array.isArray(value) && value.every((item) => item !== null && typeof item === 'object' && (item as { w?: unknown }).w === WIRE_VERSION)
}
