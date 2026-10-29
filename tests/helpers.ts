import { setLocale } from '../src/shared/i18n'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach } from 'vitest'
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

afterEach(async () => {
  await waitForGit()
  // O Windows pode demorar a soltar o diretório (antivírus, indexação): tenta de novo antes de desistir.
  while (created.length) rmSync(created.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
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
