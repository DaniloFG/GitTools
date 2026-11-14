import { setLocale } from '../src/shared/i18n'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, type TestContext } from 'vitest'
import { onGitCommand, runGit } from '../src/core/exec'
import { GitRepository } from '../src/core/repository'

// Os testes verificam mensagens em português.
setLocale('pt-BR')

const created: string[] = []

/** Comandos git ainda em execução (id -> verdadeiro). Um teste que estourou o tempo limite pode deixar um git rodando. */
const running = new Set<number>()
onGitCommand((entry) => {
  if (entry.exitCode === undefined) running.add(entry.id)
  else running.delete(entry.id)
})

/** Espera os comandos git em andamento terminarem: no Windows, um processo com o diretório aberto impede removê-lo. */
async function waitForGit(limitMs = 60_000) {
  const start = Date.now()
  while (running.size && Date.now() - start < limitMs) await new Promise((r) => setTimeout(r, 50))
}

/** O `code` de um erro do sistema (EBUSY, ESRCH...), ou undefined se o erro não traz um `code` em texto. */
export function errorCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null || !('code' in e)) return undefined
  return typeof e.code === 'string' ? e.code : undefined
}

/** Códigos em que vale tentar de novo: no Windows, quem segura a pasta costuma soltá-la em instantes. */
const RETRYABLE_RM_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES', 'EMFILE', 'ENFILE'])

/**
 * Apaga a pasta temporária de um teste. No Windows, um processo vivo (um neto do git, por exemplo, que tem o
 * repositório como diretório atual) trava a pasta com EBUSY, e o antivírus e a indexação também a seguram por um
 * tempo. Por isso tenta de novo a cada `delayMs`, mas só nesses erros e por no máximo `limitMs` contados do início:
 * a espera é limitada, nunca infinita, e esgotado o prazo o último erro sobe. Qualquer outro erro sobe na hora.
 * O `rm` padrão ainda leva as tentativas próprias do `rmSync`, como antes.
 */
export async function removeDir(
  dir: string,
  opts: { limitMs?: number; delayMs?: number; rm?: (dir: string) => void } = {}
): Promise<void> {
  const {
    limitMs = 30_000,
    delayMs = 100,
    rm = (d: string) => rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } = opts
  const start = Date.now()
  for (;;) {
    try {
      rm(dir)
      return
    } catch (error) {
      const code = errorCode(error)
      if (code === undefined || !RETRYABLE_RM_CODES.has(code) || Date.now() - start >= limitMs) throw error
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
}

/**
 * Espera o processo cujo PID está em `pidPath` sair. Primeiro sonda (a cada 50 ms) até o arquivo existir; depois
 * sonda `process.kill(pid, 0)` até lançar ESRCH (EPERM conta como vivo). O prazo total é `limitMs`. A fase de esperar
 * o arquivo tem prazo próprio, de no máximo `fileLimitMs`: se o abort chega antes de o node subir, o arquivo nunca
 * aparece e não há processo para travar a pasta, então não vale gastar o prazo todo. Se o arquivo não aparecer ou o
 * processo não sair a tempo, retorna sem erro, porque `removeDir` ainda tenta de novo na limpeza.
 */
export async function waitForExit(pidPath: string, limitMs = 15_000, fileLimitMs = 5_000): Promise<void> {
  const start = Date.now()
  const sleep = () => new Promise((r) => setTimeout(r, 50))
  const fileDeadline = Math.min(limitMs, fileLimitMs)
  let pid = NaN
  while (Date.now() - start < fileDeadline) {
    if (existsSync(pidPath)) {
      // O arquivo pode estar ainda vazio no instante em que aparece: só vale quando traz um número.
      pid = Number(readFileSync(pidPath, 'utf8').trim())
      if (Number.isInteger(pid) && pid > 0) break
    }
    await sleep()
  }
  if (!Number.isInteger(pid) || pid <= 0) return
  while (Date.now() - start < limitMs) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      // Só EPERM conta como vivo; ESRCH (ou qualquer outro erro) quer dizer que o processo saiu.
      if (errorCode(error) !== 'EPERM') return
    }
    await sleep()
  }
}

afterEach(async () => {
  await waitForGit()
  // Tenta apagar todas as pastas mesmo que uma falhe, para não deixar lixo; no fim relança o primeiro erro.
  const errors: unknown[] = []
  while (created.length) {
    try {
      await removeDir(created.pop()!)
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length) throw errors[0]
})

export interface TestRepo {
  dir: string
  repo: GitRepository
  git(...args: string[]): Promise<string>
  write(path: string, content: string): void
  commit(message: string, files?: Record<string, string>): Promise<string>
}

export async function createRepo(): Promise<TestRepo> {
  const dir = mkdtempSync(join(tmpdir(), 'gittools-test-'))
  created.push(dir)
  const git = async (...args: string[]) => (await runGit(dir, args)).stdout
  await git('init', '-q', '-b', 'main')
  await git('config', 'user.name', 'Test')
  await git('config', 'user.email', 'test@example.com')
  await git('config', 'commit.gpgsign', 'false')
  // No Windows o git costuma vir com autocrlf=true, que trocaria \n por \r\n nos arquivos e nos patches.
  await git('config', 'core.autocrlf', 'false')
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  const commit = async (message: string, files: Record<string, string> = {}) => {
    for (const [p, c] of Object.entries(files)) write(p, c)
    await git('add', '-A')
    await git('commit', '-q', '-m', message)
    return (await git('rev-parse', 'HEAD')).trim()
  }
  return { dir, repo: await GitRepository.open(dir), git, write, commit }
}

export const lines = (...items: string[]) => items.map((l) => `${l}\n`).join('')

/**
 * Cria um link simbólico ou pula o teste, se o sistema negar a criação. No Windows, criar link exige privilégio (ou
 * o modo de desenvolvedor), e a negativa vem como EPERM; EACCES e ENOSYS também são negativas do sistema. Qualquer
 * outro erro é falha de verdade e sobe. Não pula por plataforma: Linux e macOS criam o link e rodam o teste.
 */
export function linkOrSkip(ctx: TestContext, target: string, path: string, type: 'file' | 'dir' | 'junction'): void {
  try {
    symlinkSync(target, path, type)
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
    // `ctx.skip` lança a exceção que encerra o teste como pulado: por isso o `throw` abaixo não é alcançado nesse caso.
    if (code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS') ctx.skip('sem permissão para criar link simbólico')
    throw error
  }
}
