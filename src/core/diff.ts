import type { DiffHunk, DiffLine, FileDiff, LineKey } from '../shared/types'
import { changeKeys, lineKey } from '../shared/diffKeys'
import { t } from '../shared/i18n'

export { changeKeys, lineKey }

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

/** Remove as aspas no estilo C que o git usa para caminhos com caracteres especiais. */
export function unquotePath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) return value
  const body = value.slice(1, -1)
  const bytes: number[] = []
  const escapes: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92, '"': 34 }
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'))
      continue
    }
    const next = body[i + 1]
    if (next !== undefined && /[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8))
      i += 3
    } else if (next !== undefined && next in escapes) {
      bytes.push(escapes[next])
      i += 1
    } else {
      bytes.push(92)
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

/** Coloca o caminho entre aspas quando necessário, no mesmo formato aceito pelo git apply. */
export function quotePath(path: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/["\\\x00-\x1f\x7f]/.test(path)) return path
  let out = '"'
  for (const ch of path) {
    const code = ch.charCodeAt(0)
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\t') out += '\\t'
    else if (code < 0x20 || code === 0x7f) out += '\\' + code.toString(8).padStart(3, '0')
    else out += ch
  }
  return out + '"'
}

function stripPrefix(path: string, prefix: string): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

/** Extrai os caminhos da linha "diff --git a/x b/y" (usado quando não há linhas ---/+++). */
function pathsFromGitHeader(line: string): [string, string] | null {
  const rest = line.slice('diff --git '.length)
  if (rest.startsWith('"')) {
    const match = /^("(?:[^"\\]|\\.)*") (.*)$/.exec(rest)
    if (!match) return null
    return [stripPrefix(unquotePath(match[1]), 'a/'), stripPrefix(unquotePath(match[2]), 'b/')]
  }
  // Caso comum: "a/X b/X" com o mesmo caminho dos dois lados.
  const n = (rest.length - 5) / 2
  if (Number.isInteger(n) && n > 0 && rest.slice(2, 2 + n) === rest.slice(5 + n)) {
    const p = rest.slice(2, 2 + n)
    return [p, p]
  }
  const sep = rest.indexOf(' b/')
  if (sep === -1) return null
  return [stripPrefix(rest.slice(0, sep), 'a/'), unquotePath(rest.slice(sep + 1)).replace(/^b\//, '')]
}

/** Converte a saída de `git diff` (formato unificado) em uma estrutura navegável. */
export function parseDiff(text: string): FileDiff[] {
  const lines = text.split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()

  const files: FileDiff[] = []
  let i = 0
  while (i < lines.length) {
    const first = lines[i]
    if (!first.startsWith('diff --git ')) {
      i++
      continue
    }
    const file: FileDiff = {
      oldPath: null,
      newPath: null,
      path: '',
      changeType: 'modified',
      binary: false,
      headerLines: [first],
      hunks: [],
      additions: 0,
      deletions: 0
    }
    let sawMinus = false
    let sawPlus = false
    i++
    while (i < lines.length && !lines[i].startsWith('diff --git ') && !lines[i].startsWith('@@ ')) {
      const h = lines[i]
      file.headerLines.push(h)
      if (h.startsWith('new file mode')) file.changeType = 'added'
      else if (h.startsWith('deleted file mode')) file.changeType = 'deleted'
      else if (h.startsWith('rename from ')) {
        file.changeType = 'renamed'
        file.oldPath = unquotePath(h.slice('rename from '.length))
      } else if (h.startsWith('rename to ')) file.newPath = unquotePath(h.slice('rename to '.length))
      else if (h.startsWith('copy from ')) {
        file.changeType = 'copied'
        file.oldPath = unquotePath(h.slice('copy from '.length))
      } else if (h.startsWith('copy to ')) file.newPath = unquotePath(h.slice('copy to '.length))
      else if (h.startsWith('--- ')) {
        sawMinus = true
        const p = h.slice(4)
        file.oldPath = p === '/dev/null' ? null : stripPrefix(unquotePath(p), 'a/')
      } else if (h.startsWith('+++ ')) {
        sawPlus = true
        const p = h.slice(4)
        file.newPath = p === '/dev/null' ? null : stripPrefix(unquotePath(p), 'b/')
      } else if (h.startsWith('Binary files ') || h === 'GIT binary patch') file.binary = true
      i++
    }

    if (!sawMinus && !sawPlus && file.oldPath === null && file.newPath === null) {
      const paths = pathsFromGitHeader(first)
      if (paths) {
        file.oldPath = file.changeType === 'added' ? null : paths[0]
        file.newPath = file.changeType === 'deleted' ? null : paths[1]
      }
    }

    while (i < lines.length && lines[i].startsWith('@@ ')) {
      const m = HUNK_HEADER.exec(lines[i])
      if (!m) break
      const hunk: DiffHunk = {
        oldStart: Number(m[1]),
        oldCount: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newCount: m[4] === undefined ? 1 : Number(m[4]),
        section: m[5] ?? '',
        lines: []
      }
      i++
      let remainingOld = hunk.oldCount
      let remainingNew = hunk.newCount
      let oldNo = hunk.oldStart
      let newNo = hunk.newStart
      while (i < lines.length && (remainingOld > 0 || remainingNew > 0 || lines[i].startsWith('\\'))) {
        const l = lines[i]
        const tag = l[0]
        let line: DiffLine | null = null
        if (tag === ' ' || l === '') {
          line = { kind: 'context', content: l.slice(1), oldLine: oldNo++, newLine: newNo++ }
          remainingOld--
          remainingNew--
        } else if (tag === '-') {
          line = { kind: 'del', content: l.slice(1), oldLine: oldNo++, newLine: null }
          remainingOld--
          file.deletions++
        } else if (tag === '+') {
          line = { kind: 'add', content: l.slice(1), oldLine: null, newLine: newNo++ }
          remainingNew--
          file.additions++
        } else if (tag === '\\') {
          const prev = hunk.lines[hunk.lines.length - 1]
          if (prev) prev.noNewline = true
        } else {
          break
        }
        if (line) hunk.lines.push(line)
        i++
      }
      file.hunks.push(hunk)
    }

    file.path = file.newPath ?? file.oldPath ?? ''
    files.push(file)
  }
  return files
}

function formatRange(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`
}

/**
 * Monta um patch contendo apenas as linhas selecionadas de um arquivo.
 *
 * - Modo normal (reverse = false), usado para "stage" e para aplicar linhas em outra branch:
 *   linhas adicionadas não selecionadas são descartadas e linhas removidas não selecionadas
 *   viram contexto (continuam no arquivo).
 * - Modo reverso (reverse = true), usado com `git apply -R` para "unstage" e "descartar":
 *   linhas adicionadas não selecionadas viram contexto e linhas removidas não selecionadas
 *   são descartadas.
 *
 * Retorna null quando nenhuma linha alterada foi selecionada.
 */
export function buildPartialPatch(file: FileDiff, selected: Iterable<LineKey> | 'all', reverse = false): string | null {
  if (file.binary) throw new Error(t('core.binaryNoLines', { path: file.path }))
  const all = changeKeys(file)
  const chosen = selected === 'all' ? new Set(all) : new Set(selected)
  const effective = all.filter((k) => chosen.has(k))
  if (effective.length === 0) return null
  const partial = effective.length !== all.length

  const body: string[] = []
  let offset = 0
  file.hunks.forEach((hunk, h) => {
    const out: string[] = []
    let oldCount = 0
    let newCount = 0
    let changes = 0
    hunk.lines.forEach((line, l) => {
      const isSelected = chosen.has(lineKey(h, l))
      let prefix: string | null
      if (line.kind === 'context') prefix = ' '
      else if (isSelected) prefix = line.kind === 'add' ? '+' : '-'
      else if (line.kind === 'add') prefix = reverse ? ' ' : null
      else prefix = reverse ? null : ' '

      if (prefix === null) return
      if (prefix !== ' ') changes++
      if (prefix !== '+') oldCount++
      if (prefix !== '-') newCount++
      out.push(prefix + line.content)
      if (line.noNewline) out.push('\\ No newline at end of file')
    })
    if (changes === 0) return

    let newStart = hunk.oldStart + offset
    if (oldCount === 0 && newCount > 0) newStart += 1
    else if (oldCount > 0 && newCount === 0) newStart -= 1
    offset += newCount - oldCount
    const section = hunk.section ? ` ${hunk.section}` : ''
    body.push(`@@ -${formatRange(hunk.oldStart, oldCount)} +${formatRange(newStart, newCount)} @@${section}`)
    body.push(...out)
  })
  if (body.length === 0) return null

  let header = file.headerLines
  // Uma remoção (ou criação, no modo reverso) parcial deixa de ser remoção/criação do arquivo:
  // o cabeçalho precisa virar o de uma modificação comum.
  const rewrite = partial && ((!reverse && file.changeType === 'deleted') || (reverse && file.changeType === 'added'))
  if (rewrite) {
    header = file.headerLines
      .filter((h) => !/^(new|deleted) file mode /.test(h) && !h.startsWith('index '))
      .map((h) => {
        if (h === '--- /dev/null') return `--- ${quotePath(`a/${file.path}`)}`
        if (h === '+++ /dev/null') return `+++ ${quotePath(`b/${file.path}`)}`
        return h
      })
  }
  return [...header, ...body].join('\n') + '\n'
}
