import type { DiffLine, FileDiff } from '../../shared/types'

// Diz se dois diffs do mesmo arquivo têm o mesmo conteúdo. Serve para manter a MESMA referência quando uma nova
// leitura não mudou nada: a referência é o que mantém a seleção de linhas do usuário viva. Antes isso era feito com
// `JSON.stringify` dos dois lados, o que serializa ~1,6 MB (diff de 5.000 linhas) duas vezes a cada atualização.
//
// O atalho: o git escreve no cabeçalho `index <hash-antigo>..<hash-novo> <modo>`, o hash do conteúdo de cada lado.
// Com o cabeçalho igual, o conteúdo dos dois lados é igual, e os hunks (que vêm desse mesmo conteúdo e das mesmas
// opções de leitura) também. Por isso, quando há `index`, comparar os metadados do hunk basta. Arquivo não rastreado
// (montado em `untrackedDiff`, sem hash) não tem esse atalho: aí as linhas são comparadas uma a uma, com saída
// antecipada na primeira diferença. Em qualquer dos dois casos não se cria string nem array.

const linesEqual = (a: DiffLine, b: DiffLine): boolean =>
  a.kind === b.kind &&
  a.content === b.content &&
  a.oldLine === b.oldLine &&
  a.newLine === b.newLine &&
  (a.noNewline ?? false) === (b.noNewline ?? false)

export function sameDiff(a: FileDiff, b: FileDiff): boolean {
  if (a === b) return true
  if (
    a.path !== b.path ||
    a.oldPath !== b.oldPath ||
    a.newPath !== b.newPath ||
    a.changeType !== b.changeType ||
    a.binary !== b.binary ||
    (a.truncated ?? false) !== (b.truncated ?? false) ||
    a.additions !== b.additions ||
    a.deletions !== b.deletions
  )
    return false

  // Cabeçalhos (modo, `index`, `---`/`+++`, renomeação, modo antigo/novo). Um diff só de modo, ou binário, pode não
  // ter hunks: por isso eles entram na comparação.
  if (a.headerLines.length !== b.headerLines.length) return false
  let hasIndex = false
  for (let i = 0; i < a.headerLines.length; i++) {
    const line = a.headerLines[i]
    if (line !== b.headerLines[i]) return false
    if (line.startsWith('index ')) hasIndex = true
  }

  if (a.hunks.length !== b.hunks.length) return false
  for (let h = 0; h < a.hunks.length; h++) {
    const x = a.hunks[h]
    const y = b.hunks[h]
    if (
      x.oldStart !== y.oldStart ||
      x.oldCount !== y.oldCount ||
      x.newStart !== y.newStart ||
      x.newCount !== y.newCount ||
      x.section !== y.section ||
      x.lines.length !== y.lines.length
    )
      return false
  }

  // Com o mesmo `index`, o conteúdo é o mesmo: não há o que percorrer.
  if (hasIndex) return true

  for (let h = 0; h < a.hunks.length; h++) {
    const xs = a.hunks[h].lines
    const ys = b.hunks[h].lines
    for (let l = 0; l < xs.length; l++) if (!linesEqual(xs[l], ys[l])) return false
  }
  return true
}
