import { spawn } from 'node:child_process'
import { t } from '../shared/i18n'
import type { GitCommandEntry } from '../shared/types'

type CommandListener = (entry: GitCommandEntry) => void
const commandListeners = new Set<CommandListener>()
let nextCommandId = 1

/**
 * Avisa sobre cada comando git executado: uma vez ao começar e outra ao terminar (com duração,
 * código de saída e erro). Usado pelo log de comandos em tempo real.
 */
export function onGitCommand(listener: CommandListener): () => void {
  commandListeners.add(listener)
  return () => {
    commandListeners.delete(listener)
  }
}

function emitCommand(entry: GitCommandEntry) {
  for (const listener of commandListeners) {
    try {
      listener(entry)
    } catch {
      // Um ouvinte com problema não pode atrapalhar o comando.
    }
  }
}

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly exitCode: number,
    readonly stdout: string,
    readonly stderr: string
  ) {
    super(message)
    this.name = 'GitError'
  }
}

export interface RunOptions {
  /** Texto enviado para a entrada padrão do git (ex.: um patch para `git apply -`). */
  input?: string
  /** Códigos de saída considerados sucesso (padrão: [0]). */
  okExitCodes?: number[]
  env?: NodeJS.ProcessEnv
}

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Remove as dicas ("hint: ...") do git, que só fazem sentido no terminal. */
export function cleanMessage(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.startsWith('hint:'))
    .join('\n')
    .trim()
}

const BASE_ARGS = ['-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'advice.detachedHead=false']

/**
 * Executa um comando git sem shell (os argumentos nunca são interpretados) e sem
 * prompts interativos: editores viram no-op e credenciais nunca são pedidas no terminal.
 */
export function runGit(cwd: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const entry: GitCommandEntry = { id: nextCommandId++, args, cwd, startedAt: Date.now() }
  emitCommand(entry)
  const finish = (exitCode: number, error?: string) =>
    emitCommand({
      ...entry,
      exitCode,
      durationMs: Date.now() - entry.startedAt,
      ...(error !== undefined ? { failed: true, error: error.split('\n')[0] } : {})
    })
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...BASE_ARGS, ...args], {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_EDITOR: 'true',
        GIT_SEQUENCE_EDITOR: 'true',
        GIT_MERGE_AUTOEDIT: 'no',
        GIT_PAGER: 'cat',
        // Saída do git sempre em inglês: a interface traduz o que importa e o
        // código que interpreta mensagens do git não depende do idioma do sistema.
        LC_ALL: 'en_US.UTF-8',
        LANG: 'en_US.UTF-8',
        LANGUAGE: 'en',
        ...options.env
      }
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => err.push(d))
    child.on('error', (e) => {
      finish(-1, e.message)
      reject(new GitError(t('core.gitNotFound', { error: e.message }), args, -1, '', ''))
    })
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8')
      const stderr = Buffer.concat(err).toString('utf8')
      const exitCode = code ?? -1
      if ((options.okExitCodes ?? [0]).includes(exitCode)) {
        finish(exitCode)
        resolve({ stdout, stderr, exitCode })
      } else {
        const message = cleanMessage(stderr) || cleanMessage(stdout) || t('core.gitFailed', { command: args[0], code: exitCode })
        finish(exitCode, message)
        reject(new GitError(message, args, exitCode, stdout, stderr))
      }
    })
    child.stdin.on('error', () => {
      // O git pode fechar a entrada antes de lermos tudo; o erro real aparece no código de saída.
    })
    child.stdin.end(options.input ?? '')
  })
}
