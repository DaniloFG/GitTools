// Sugestões do terminal git (Tab / lista enquanto digita). Função pura: recebe a linha, a posição do
// cursor e o que existe no repositório aberto (branches, tags, remotes, arquivos alterados).

import { GIT_COMMANDS, LOCAL_COMMANDS, findCommand, flagNames, pickText, type GitCommandSpec, type GitFlag } from './gitCommands'

/** O que o repositório aberto tem para completar. */
export interface RepoContext {
  branches: string[]
  tags: string[]
  remotes: string[]
  /** Caminhos alterados (preparados, não preparados ou em conflito). */
  paths: string[]
  /** Idioma da interface: escolhe a descrição (pt-BR ou en). */
  locale: string
}

export type SuggestionKind = 'command' | 'local' | 'flag' | 'op' | 'branch' | 'tag' | 'remote' | 'path'

export interface Suggestion {
  kind: SuggestionKind
  /** Texto mostrado na lista. */
  label: string
  /** Texto que substitui o trecho digitado. */
  insert: string
  /** Descrição curta do que faz (vazia para refs e caminhos). */
  detail: string
}

export interface Suggestions {
  /** Onde começa o trecho que será substituído (até o cursor). */
  start: number
  items: Suggestion[]
  /** Subcomando em uso, para o painel de ajuda. */
  command: GitCommandSpec | null
}

interface Token {
  text: string
  start: number
  end: number
}

/** Quebra o texto em palavras (aspas e \ são respeitadas; as posições são as do texto original). */
function tokenize(text: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++
      continue
    }
    const start = i
    let value = ''
    let quote: string | null = null
    while (i < text.length) {
      const ch = text[i]
      if (quote) {
        if (ch === quote) quote = null
        else value += ch
        i++
      } else if (ch === '"' || ch === "'") {
        quote = ch
        i++
      } else if (/\s/.test(ch)) {
        break
      } else if (ch === '\\' && i + 1 < text.length) {
        value += text[i + 1]
        i += 2
      } else {
        value += ch
        i++
      }
    }
    out.push({ text: value, start, end: i })
  }
  return out
}

const MAX_ITEMS = 60

/** A opção (ou ação) recebe um valor logo depois, então a palavra seguinte não é um argumento. */
function takesValue(spec: GitCommandSpec, word: string): boolean {
  return [...spec.flags, ...(spec.ops ?? [])].some((flag) => flag.value && flagNames(flag).includes(word))
}

/** Quantas palavras são argumentos de verdade (sem opções, nem os valores delas). */
function positionals(spec: GitCommandSpec, words: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (w.startsWith('-')) {
      if (takesValue(spec, w)) i++
      continue
    }
    out.push(w)
  }
  return out
}

/** Filtra pelo começo do que foi digitado (sem diferenciar maiúsculas) e devolve o nome que casou. */
function matchName(names: string[], prefix: string): string | null {
  const p = prefix.toLowerCase()
  return names.find((n) => n.toLowerCase().startsWith(p)) ?? null
}

function flagItems(flags: GitFlag[], prefix: string, locale: string): Suggestion[] {
  const items: Suggestion[] = []
  for (const flag of flags) {
    const insert = matchName(flagNames(flag), prefix)
    if (insert !== null) items.push({ kind: 'flag', label: flag.name, insert, detail: pickText(flag.text, locale) })
  }
  return items
}

function namedItems(kind: SuggestionKind, names: string[], prefix: string): Suggestion[] {
  return names.filter((n) => n.toLowerCase().startsWith(prefix.toLowerCase())).map((n) => ({ kind, label: n, insert: n, detail: '' }))
}

/** Sugestões para a posição do cursor. `line` é a linha inteira; só o que está antes do cursor conta. */
export function suggest(line: string, cursor: number, ctx: RepoContext): Suggestions {
  const before = line.slice(0, Math.max(0, Math.min(cursor, line.length)))
  const tokens = tokenize(before)
  const atWordStart = before.length === 0 || /\s$/.test(before)
  const current: Token = atWordStart ? { text: '', start: before.length, end: before.length } : tokens[tokens.length - 1]
  const words = (atWordStart ? tokens : tokens.slice(0, -1)).map((t) => t.text)
  const prefix = current.text
  const result = (items: Suggestion[], command: GitCommandSpec | null = null): Suggestions => ({
    start: current.start,
    items: items.slice(0, MAX_ITEMS),
    command
  })

  // Primeira palavra (ou a seguir a "git"): o subcomando, ou um comando local.
  const offset = words[0] === 'git' ? 1 : 0
  if (words.length === offset) {
    const items: Suggestion[] = []
    if (offset === 0) items.push(...LOCAL_COMMANDS.filter((c) => matchName([c.name], prefix)).map((c) => ({ kind: 'local' as const, label: c.name, insert: c.name, detail: pickText(c.text, ctx.locale) })))
    for (const c of GIT_COMMANDS) {
      if (matchName([c.name], prefix)) items.push({ kind: 'command', label: c.name, insert: c.name, detail: pickText(c.text, ctx.locale) })
    }
    return result(items)
  }

  // "help <comando>": sugere os comandos do git.
  if (words[0] === 'help' && words.length === 1) {
    return result(GIT_COMMANDS.filter((c) => matchName([c.name], prefix)).map((c) => ({ kind: 'command' as const, label: c.name, insert: c.name, detail: pickText(c.text, ctx.locale) })))
  }

  const spec = findCommand(words[offset])
  if (!spec) return result([])
  const argWords = words.slice(offset + 1)

  // Depois de "--": só caminhos.
  if (argWords.includes('--')) return result(namedItems('path', ctx.paths, prefix), spec)

  // O valor de uma opção (ex.: o texto depois de -m) não tem sugestão.
  if (argWords.length > 0 && takesValue(spec, argWords[argWords.length - 1])) return result([], spec)

  if (prefix.startsWith('-')) return result(flagItems(spec.flags, prefix, ctx.locale), spec)

  const args = positionals(spec, argWords)
  if (spec.ops && args.length === 0) {
    return result(
      spec.ops
        .filter((op) => matchName(flagNames(op), prefix))
        .map((op) => ({ kind: 'op' as const, label: op.name, insert: op.name, detail: pickText(op.text, ctx.locale) })),
      spec
    )
  }

  switch (spec.args) {
    case 'path':
      return result(namedItems('path', ctx.paths, prefix), spec)
    case 'remote':
      return result(namedItems('remote', ctx.remotes, prefix), spec)
    case 'remote-ref':
      if (args.length === 0) return result(namedItems('remote', ctx.remotes, prefix), spec)
      return result([...namedItems('branch', ctx.branches, prefix), ...namedItems('tag', ctx.tags, prefix)], spec)
    case 'ref':
      return result([...namedItems('branch', ctx.branches, prefix), ...namedItems('tag', ctx.tags, prefix)], spec)
    default:
      return result([], spec)
  }
}

/**
 * Troca o trecho digitado pela sugestão escolhida (e põe um espaço depois). O resto da palavra que
 * estava depois do cursor é absorvido, então escolher no meio de uma palavra não deixa sobra.
 */
export function applySuggestion(line: string, cursor: number, suggestions: Suggestions, item: Suggestion): { line: string; cursor: number } {
  const head = line.slice(0, suggestions.start)
  const tail = line.slice(cursor).replace(/^\S*/, '')
  const insert = `${item.insert} `
  return { line: `${head}${insert}${tail}`, cursor: head.length + insert.length }
}
