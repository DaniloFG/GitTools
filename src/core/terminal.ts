// Execução dos comandos do terminal git: valida a linha (sem shell), confere aliases com "!" e roda
// pelo executor comum, para que cada comando também apareça no log em tempo real.

import { t } from '../shared/i18n'
import { validateGitCommand, type TerminalCommandResult } from '../shared/terminal'
import { GitError, runGit } from './exec'

/** Tempo máximo de um comando digitado no terminal. */
export const TERMINAL_TIMEOUT_MS = 120_000
/** Bytes guardados de cada saída (stdout e stderr) do terminal. */
export const TERMINAL_MAX_OUTPUT = 2 * 1024 * 1024

function refused(error: string): TerminalCommandResult {
  return { ok: false, exitCode: -1, stdout: '', stderr: error, args: [], durationMs: 0 }
}

/** Um alias "!comando" roda um programa de shell: o terminal não executa. (Consulta silenciosa, fora do log.) */
async function isShellAlias(cwd: string, subcommand: string): Promise<boolean> {
  try {
    const { stdout } = await runGit(cwd, ['config', '--get', `alias.${subcommand}`], { okExitCodes: [0, 1], silent: true })
    return stdout.trim().startsWith('!')
  } catch {
    return false
  }
}

/** Roda uma linha digitada pelo usuário no repositório `cwd`. Nunca lança por erro do comando: devolve o resultado. */
export async function runTerminalCommand(cwd: string, line: string): Promise<TerminalCommandResult> {
  const check = validateGitCommand(line)
  if (!check.ok) return refused(check.error)
  if (await isShellAlias(cwd, check.subcommand)) return refused(t('gitTerminal.err.shellAlias', { name: check.subcommand }))

  const started = Date.now()
  try {
    const result = await runGit(cwd, check.args, { timeoutMs: TERMINAL_TIMEOUT_MS, maxOutputBytes: TERMINAL_MAX_OUTPUT })
    return {
      ok: true,
      exitCode: result.exitCode,
      stdout: withTruncationNote(result.stdout, result.truncated),
      stderr: result.stderr,
      args: check.args,
      durationMs: Date.now() - started
    }
  } catch (error) {
    if (!(error instanceof GitError)) throw error
    return {
      ok: false,
      exitCode: error.exitCode,
      stdout: withTruncationNote(error.stdout, error.truncated),
      // Sem código de saída (tempo esgotado, git não encontrado) a mensagem é o próprio erro.
      stderr: error.exitCode === -1 ? error.message : error.stderr,
      args: check.args,
      durationMs: Date.now() - started
    }
  }
}

function withTruncationNote(text: string, truncated?: boolean): string {
  if (!truncated) return text
  const size = `${TERMINAL_MAX_OUTPUT / (1024 * 1024)} MB`
  return `${text}${text.endsWith('\n') || text === '' ? '' : '\n'}${t('gitTerminal.truncated', { size })}\n`
}
