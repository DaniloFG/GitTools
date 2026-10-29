import { spawn } from 'node:child_process'
import { t } from '../shared/i18n'
import type { GitCommandEntry } from '../shared/types'
import { ARG_BUDGET, MAX_COMMAND_CHARS, commandChars } from './chunk'

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
    readonly stderr: string,
    /** A saída foi cortada no limite (RunOptions.maxOutputBytes). */
    readonly truncated = false
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
  /** Tempo máximo em ms: passado, o git é interrompido e o comando falha. */
  timeoutMs?: number
  /** Bytes guardados de cada saída (stdout e stderr); o excedente é descartado e `truncated` fica verdadeiro. */
  maxOutputBytes?: number
  /** Não aparece no log de comandos (consultas internas do próprio GitTools). */
  silent?: boolean
}

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
  /** Alguma saída foi cortada em RunOptions.maxOutputBytes. */
  truncated?: boolean
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
  const announce = (e: GitCommandEntry) => {
    if (!options.silent) emitCommand(e)
  }
  announce(entry)
  const finish = (exitCode: number, error?: string) =>
    announce({
      ...entry,
      exitCode,
      durationMs: Date.now() - entry.startedAt,
      ...(error !== undefined ? { failed: true, error: error.split('\n')[0] } : {})
    })
  return new Promise((resolve, reject) => {
    const commandSize = commandChars([...BASE_ARGS, ...args])
    if (commandSize > MAX_COMMAND_CHARS) {
      // Nem inicia o git: a linha de comando estouraria o limite do sistema (o erro seria um ENOENT ou E2BIG cru).
      const message = t('commandLimit.tooLong', { command: args[0] })
      finish(-1, message)
      reject(new GitError(message, args, -1, '', ''))
      return
    }
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
        // A interface consulta o status o tempo todo: sem isso o git regrava o index (e o trava) a cada consulta.
        GIT_OPTIONAL_LOCKS: '0',
        // Saída do git sempre em inglês: a interface traduz o que importa e o
        // código que interpreta mensagens do git não depende do idioma do sistema.
        LC_ALL: 'en_US.UTF-8',
        LANG: 'en_US.UTF-8',
        LANGUAGE: 'en',
        ...options.env
      }
    })
    // Guarda no máximo `maxOutputBytes` de cada saída; o resto é lido e descartado (o git termina normalmente).
    const limit = options.maxOutputBytes ?? Infinity
    const kept = { out: 0, err: 0 }
    let truncated = false
    const collect = (chunks: Buffer[], key: 'out' | 'err') => (d: Buffer) => {
      const room = limit - kept[key]
      if (d.length <= room) {
        chunks.push(d)
        kept[key] += d.length
        return
      }
      truncated = true
      if (room > 0) {
        chunks.push(d.subarray(0, room))
        kept[key] += room
      }
    }
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', collect(out, 'out'))
    child.stderr.on('data', collect(err, 'err'))
    let timedOut = false
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill('SIGTERM')
        }, options.timeoutMs)
      : null
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (timer) clearTimeout(timer)
      // Linha de comando longa demais: o Linux responde E2BIG/ENAMETOOLONG e o Windows, ENOENT.
      const tooLong = e.code === 'E2BIG' || e.code === 'ENAMETOOLONG' || (e.code === 'ENOENT' && commandSize > ARG_BUDGET)
      const message = tooLong ? t('commandLimit.tooLong', { command: args[0] }) : t('core.gitNotFound', { error: e.message })
      finish(-1, message)
      reject(new GitError(message, args, -1, '', ''))
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      const stdout = Buffer.concat(out).toString('utf8')
      const stderr = Buffer.concat(err).toString('utf8')
      const exitCode = code ?? -1
      if (timedOut) {
        const message = t('gitTerminal.timeout', { seconds: Math.round((options.timeoutMs ?? 0) / 1000) })
        finish(-1, message)
        reject(new GitError(message, args, -1, stdout, stderr, truncated))
      } else if ((options.okExitCodes ?? [0]).includes(exitCode)) {
        finish(exitCode)
        resolve({ stdout, stderr, exitCode, truncated })
      } else {
        const message = cleanMessage(stderr) || cleanMessage(stdout) || t('core.gitFailed', { command: args[0], code: exitCode })
        finish(exitCode, message)
        reject(new GitError(message, args, exitCode, stdout, stderr, truncated))
      }
    })
    child.stdin.on('error', () => {
      // O git pode fechar a entrada antes de lermos tudo; o erro real aparece no código de saída.
    })
    child.stdin.end(options.input ?? '')
  })
}
