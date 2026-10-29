// Terminal git: lê a linha digitada sem shell e recusa o que não cabe num terminal de git
// (pipes, encadeamento, programas arbitrários via configuração, comandos interativos).
// Puro: não depende de Electron nem do sistema de arquivos, então é testado direto.

import { t } from './i18n'

/** Resultado de um comando do terminal (a interface mostra stdout, stderr e o código de saída). */
export interface TerminalCommandResult {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
  /** Argumentos passados ao git (sem o "git" inicial). */
  args: string[]
  durationMs: number
}

export type ParseResult = { ok: true; tokens: string[] } | { ok: false; error: string }

/** Tamanho máximo da linha digitada. */
export const MAX_COMMAND_LENGTH = 4000

/** Operadores de shell: não existem aqui, então são recusados com explicação (e não tratados como texto). */
const OPERATORS = new Set(['|', '&', ';', '<', '>'])

/**
 * Divide a linha em palavras, como um shell faria com aspas e escapes, mas sem expandir nada:
 * `$HOME`, `*` e `~` continuam sendo texto. Aspas simples são literais; nas duplas, `\"` e `\\` escapam.
 */
export function parseCommandLine(line: string): ParseResult {
  if (line.length > MAX_COMMAND_LENGTH) return { ok: false, error: t('gitTerminal.err.tooLong', { max: MAX_COMMAND_LENGTH }) }
  const tokens: string[] = []
  let current = ''
  let inToken = false
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (inToken) tokens.push(current)
      current = ''
      inToken = false
      i++
    } else if (ch === "'") {
      const end = line.indexOf("'", i + 1)
      if (end < 0) return { ok: false, error: t('gitTerminal.err.unclosedQuote') }
      current += line.slice(i + 1, end)
      inToken = true
      i = end + 1
    } else if (ch === '"') {
      inToken = true
      i++
      let closed = false
      while (i < line.length) {
        const c = line[i]
        if (c === '"') {
          closed = true
          i++
          break
        }
        if (c === '\\' && (line[i + 1] === '"' || line[i + 1] === '\\')) {
          current += line[i + 1]
          i += 2
          continue
        }
        current += c
        i++
      }
      if (!closed) return { ok: false, error: t('gitTerminal.err.unclosedQuote') }
    } else if (ch === '\\') {
      if (i + 1 >= line.length) return { ok: false, error: t('gitTerminal.err.trailingBackslash') }
      current += line[i + 1]
      inToken = true
      i += 2
    } else if (OPERATORS.has(ch)) {
      return { ok: false, error: t('gitTerminal.err.operator', { op: ch }) }
    } else {
      current += ch
      inToken = true
      i++
    }
  }
  if (inToken) tokens.push(current)
  return { ok: true, tokens }
}

export type GitCheck = { ok: true; args: string[]; subcommand: string } | { ok: false; error: string }

const SUBCOMMAND = /^[A-Za-z][A-Za-z0-9-]*$/
/** Opções globais que mudariam a pasta ou o diretório do git: o terminal fica sempre na raiz do repositório aberto. */
const FORBIDDEN_GLOBAL = ['-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--exec-path', '--bare']
/** Opções que fazem o git executar um programa qualquer (não só o git). */
const EXECUTABLE_OPTIONS = /^--(exec-path|upload-pack|receive-pack)(=|$)/
/**
 * Chaves de configuração que apontam para um programa: `-c core.sshCommand=…` ou `filter.x.clean=…` executariam
 * esse programa. Qualquer segmento da chave com um desses nomes é recusado (alias.* é tratado à parte).
 */
const PROGRAM_SEGMENTS = new Set([
  'sshcommand', 'askpass', 'editor', 'pager', 'program', 'cmd', 'command', 'helper', 'fsmonitor', 'hookspath',
  'gitproxy', 'external', 'packobjectshook', 'textconv', 'clean', 'smudge', 'process', 'driver', 'sequenceeditor'
])
const STASH_OPS = new Set(['push', 'save', 'pop', 'apply', 'list', 'show', 'drop', 'branch', 'clear', 'create', 'store'])
/** Comandos que abrem uma ferramenta gráfica ou um programa que pede resposta: não existem neste terminal. */
const EXTERNAL_TOOLS = new Set(['gui', 'citool', 'difftool', 'mergetool', 'instaweb', 'daemon', 'send-email', 'web--browse'])

/** Verdadeiro se a chave de configuração aponta para um programa. */
export function isProgramConfigKey(key: string): boolean {
  if (key.toLowerCase().startsWith('alias.')) return false
  return key
    .toLowerCase()
    .split('.')
    .some((segment) => PROGRAM_SEGMENTS.has(segment))
}

/** Uma opção está presente (exata ou com "=valor" para as longas). */
function hasFlag(args: string[], names: string[]): boolean {
  return args.some((a) => names.some((n) => a === n || (n.startsWith('--') && a.startsWith(`${n}=`))))
}

/** Letras curtas juntas (`-am`, `-pn`…) incluem a letra dada. Opções longas não contam. */
function hasLetter(args: string[], letter: string): boolean {
  return args.some((a) => /^-[A-Za-z]+$/.test(a) && a.includes(letter))
}

interface Refusal {
  /** O comando que não pode rodar aqui (ex.: "rebase -i"). */
  command: string
  /** Como fazer o mesmo sem a interação. */
  hint: string
  kind: 'interactive' | 'editor'
}

/** Verifica se o subcomando precisaria de um editor ou de uma resposta interativa. */
function refusalFor(sub: string, args: string[]): Refusal | null {
  const interactive = (command: string, hint: string): Refusal => ({ command, hint, kind: 'interactive' })
  const editor = (hint: string): Refusal => ({ command: sub, hint, kind: 'editor' })
  const hintTools = t('gitTerminal.hint.tools')
  if (EXTERNAL_TOOLS.has(sub)) return interactive(sub, hintTools)
  switch (sub) {
    case 'rebase':
      if (hasLetter(args, 'i') || hasFlag(args, ['--interactive', '--edit-todo'])) return interactive('rebase -i', t('gitTerminal.hint.rebase'))
      return null
    case 'add':
      if (hasFlag(args, ['--patch', '--interactive', '--edit']) || hasLetter(args, 'p') || hasLetter(args, 'i') || hasLetter(args, 'e'))
        return interactive('add -p', t('gitTerminal.hint.add'))
      return null
    case 'clean':
      if (hasFlag(args, ['--interactive']) || hasLetter(args, 'i')) return interactive('clean -i', t('gitTerminal.hint.clean'))
      return null
    case 'checkout':
    case 'restore':
    case 'reset':
    case 'commit':
      if (hasFlag(args, ['--patch']) || hasLetter(args, 'p')) return interactive(`${sub} -p`, t('gitTerminal.hint.patch'))
      if (sub === 'commit') return commitRefusal(args)
      return null
    case 'stash': {
      const op = args.find((a) => STASH_OPS.has(a)) ?? 'push'
      if ((op === 'push' || op === 'save') && (hasFlag(args, ['--patch']) || hasLetter(args, 'p')))
        return interactive('stash -p', t('gitTerminal.hint.patch'))
      return null
    }
    case 'tag': {
      const annotated = hasLetter(args, 'a') || hasLetter(args, 's') || hasFlag(args, ['--annotate', '--sign'])
      const listing = hasLetter(args, 'l') || hasLetter(args, 'd') || hasFlag(args, ['--list', '--delete', '--verify'])
      const message = hasLetter(args, 'm') || hasLetter(args, 'F') || hasFlag(args, ['--message', '--file'])
      if (annotated && !listing && !message) return editor(t('gitTerminal.hint.tag'))
      return null
    }
    case 'config':
      if (hasFlag(args, ['--edit']) || hasLetter(args, 'e')) return editor(t('gitTerminal.hint.config'))
      return null
    case 'help':
      if (hasFlag(args, ['--web']) || hasLetter(args, 'w')) return interactive('help -w', hintTools)
      return null
    default:
      return null
  }
}

/** `git commit` sem -m/-F/--no-edit abriria o editor de mensagens. */
function commitRefusal(args: string[]): Refusal | null {
  if (hasLetter(args, 'm') || hasLetter(args, 'F') || hasLetter(args, 'C')) return null
  if (hasFlag(args, ['--message', '--file', '--reuse-message', '--no-edit'])) return null
  // --fixup=<commit> cria o commit sem editor; amend: e reword: é que abrem o editor.
  const fi = args.findIndex((a) => a === '--fixup' || a.startsWith('--fixup='))
  if (fi >= 0) {
    const value = args[fi].includes('=') ? args[fi].slice(args[fi].indexOf('=') + 1) : (args[fi + 1] ?? '')
    if (!/^(amend|reword):/.test(value)) return null
  }
  return { command: 'commit', hint: t('gitTerminal.hint.commit'), kind: 'editor' }
}

/**
 * Valida a linha antes de executar: aceita "git status" ou só "status". Devolve os argumentos do git
 * (sem o "git") e o subcomando. Não executa nada: a execução confere, ainda, aliases com "!" (ver core/terminal).
 */
export function validateGitCommand(line: string): GitCheck {
  const parsed = parseCommandLine(line)
  if (!parsed.ok) return parsed
  const tokens = parsed.tokens
  if (tokens.length === 0) return { ok: false, error: t('gitTerminal.err.empty') }
  const rest = tokens[0] === 'git' ? tokens.slice(1) : tokens
  if (rest.length === 0) return { ok: false, error: t('gitTerminal.err.noSubcommand') }

  // Em qualquer posição: programas executados pelo git e configurações que apontam para programas.
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (EXECUTABLE_OPTIONS.test(a)) return { ok: false, error: t('gitTerminal.err.execOption', { option: a.split('=')[0] }) }
    if (a === '-c' && i + 1 < rest.length) {
      const value = rest[i + 1]
      const eq = value.indexOf('=')
      const key = eq < 0 ? value : value.slice(0, eq)
      const val = eq < 0 ? '' : value.slice(eq + 1)
      if (val.trimStart().startsWith('!')) return { ok: false, error: t('gitTerminal.err.shellAlias', { name: key }) }
      if (isProgramConfigKey(key)) return { ok: false, error: t('gitTerminal.err.shellConfig', { key }) }
    }
    if (a === '--config-env' || a.startsWith('--config-env=')) {
      const name = a.includes('=') ? a.slice(a.indexOf('=') + 1) : (rest[i + 1] ?? '')
      const key = name.split('=')[0]
      if (isProgramConfigKey(key)) return { ok: false, error: t('gitTerminal.err.shellConfig', { key }) }
    }
  }

  // Opções globais antes do subcomando (-c e --config-env levam um valor).
  let s = 0
  while (s < rest.length && rest[s].startsWith('-')) {
    const a = rest[s]
    if (a === '-c' || a === '--config-env') {
      s += 2
      continue
    }
    if (FORBIDDEN_GLOBAL.includes(a.split('=')[0])) return { ok: false, error: t('gitTerminal.err.globalOption', { option: a.split('=')[0] }) }
    s++
  }
  if (s >= rest.length) return { ok: false, error: t('gitTerminal.err.noSubcommand') }
  const sub = rest[s]
  if (!SUBCOMMAND.test(sub)) return { ok: false, error: t('gitTerminal.err.notGit') }

  // Gravar uma chave que aponta para um programa (ou um alias de shell) faria o git executá-lo depois.
  if (sub === 'config') {
    const positional = rest.slice(s + 1).filter((a) => !a.startsWith('-'))
    const [key, value] = positional
    if (key !== undefined && value !== undefined) {
      if (value.trimStart().startsWith('!') && key.toLowerCase().startsWith('alias.')) return { ok: false, error: t('gitTerminal.err.shellAlias', { name: key.slice(6) }) }
      if (isProgramConfigKey(key)) return { ok: false, error: t('gitTerminal.err.shellConfig', { key }) }
    }
  }

  const refusal = refusalFor(sub, rest.slice(s + 1))
  if (refusal) {
    const error =
      refusal.kind === 'editor'
        ? t('gitTerminal.err.editor', { command: refusal.command, hint: refusal.hint })
        : t('gitTerminal.err.interactive', { command: refusal.command, hint: refusal.hint })
    return { ok: false, error }
  }
  return { ok: true, args: rest, subcommand: sub }
}
