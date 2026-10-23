// Texto do editor embutido (sem React nem DOM, para poder ser testado à parte): quebras de linha e BOM do
// arquivo, posição do cursor e a correspondência entre as linhas do que está sendo digitado e as do arquivo salvo.

/** O texto como o editor o mostra (sempre com `\n`) e o que é preciso para gravá-lo como o arquivo era. */
export interface EditorText {
  text: string
  /** Quebra de linha do arquivo original. */
  eol: '\n' | '\r\n'
  bom: boolean
}

export function fromFile(raw: string): EditorText {
  const bom = raw.charCodeAt(0) === 0xfeff
  const body = bom ? raw.slice(1) : raw
  const crlf = (body.match(/\r\n/g) ?? []).length
  const lf = (body.match(/\n/g) ?? []).length - crlf
  // Maioria de CRLF → arquivo CRLF; arquivos misturados são normalizados para a quebra dominante ao salvar.
  const eol = crlf > lf ? '\r\n' : '\n'
  return { text: body.replace(/\r\n/g, '\n'), eol, bom }
}

export function toFile(text: string, original: Pick<EditorText, 'eol' | 'bom'>): string {
  const body = original.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text
  return original.bom ? `﻿${body}` : body
}

/** Linha (1 a n) e coluna (0 a n) do cursor na posição `offset` do texto. */
export function caretPosition(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)))
  const lineStart = before.lastIndexOf('\n') + 1
  let line = 1
  for (let i = before.indexOf('\n'); i !== -1; i = before.indexOf('\n', i + 1)) line++
  return { line, column: before.length - lineStart }
}

/** Texto de uma linha (1 a n). */
export function lineText(text: string, line: number): string {
  let start = 0
  for (let n = 1; n < line; n++) {
    const next = text.indexOf('\n', start)
    if (next === -1) return ''
    start = next + 1
  }
  const end = text.indexOf('\n', start)
  return text.slice(start, end === -1 ? undefined : end)
}

/** Largura, em colunas de caractere, que o início da linha ocupa até `column` (a tabulação anda até o próximo múltiplo de `tabSize`). */
export function visualColumn(line: string, column: number, tabSize = 4): number {
  let width = 0
  for (const char of line.slice(0, column)) width = char === '\t' ? width + tabSize - (width % tabSize) : width + 1
  return width
}

/** Maior produto de linhas (antes × depois) comparado exatamente; acima disso, o trecho alterado inteiro conta como editado. */
const MAX_DIFF_CELLS = 2_500_000

/**
 * Para cada linha do texto novo, a linha (1 a n) do texto antigo de onde ela veio, ou null se foi escrita/alterada
 * (ainda não salva). Serve para saber de qual linha do arquivo salvo vem o blame de uma linha do editor.
 */
export function lineOrigins(oldText: string, newText: string): (number | null)[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const result: (number | null)[] = new Array(b.length).fill(null)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) {
    result[start] = start + 1
    start++
  }
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
    result[endB] = endA + 1
  }
  const rows = endA - start
  const cols = endB - start
  if (rows === 0 || cols === 0 || rows * cols > MAX_DIFF_CELLS) return result

  // Maior subsequência comum do trecho do meio.
  const width = cols + 1
  const table = new Uint32Array((rows + 1) * width)
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i * width + j] = a[start + i] === b[start + j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    if (a[start + i] === b[start + j]) {
      result[start + j] = start + i + 1
      i++
      j++
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++
    else j++
  }
  return result
}

/** Recuo usado pelo arquivo (tabulação, 2 ou 4 espaços), para a tecla Tab combinar com o que já está lá. */
export function detectIndent(text: string): string {
  let tabs = 0
  let spaces = 0
  let unit = 0
  const lines = text.split('\n', 400)
  for (const line of lines) {
    if (line.startsWith('\t')) tabs++
    else {
      const n = /^ */.exec(line)![0].length
      if (n >= 2 && line.trim()) {
        spaces++
        unit = unit === 0 ? n : gcd(unit, n)
      }
    }
  }
  if (tabs > spaces) return '\t'
  return unit >= 4 ? '    ' : '  '
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
