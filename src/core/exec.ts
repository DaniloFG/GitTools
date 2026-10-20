import { spawn } from 'node:child_process'

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
        ...options.env
      }
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => err.push(d))
    child.on('error', (e) => reject(new GitError(`Não foi possível executar o git: ${e.message}`, args, -1, '', '')))
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8')
      const stderr = Buffer.concat(err).toString('utf8')
      const exitCode = code ?? -1
      if ((options.okExitCodes ?? [0]).includes(exitCode)) {
        resolve({ stdout, stderr, exitCode })
      } else {
        const message = cleanMessage(stderr) || cleanMessage(stdout) || `git ${args[0]} falhou (código ${exitCode})`
        reject(new GitError(message, args, exitCode, stdout, stderr))
      }
    })
    child.stdin.on('error', () => {
      // O git pode fechar a entrada antes de lermos tudo; o erro real aparece no código de saída.
    })
    child.stdin.end(options.input ?? '')
  })
}
