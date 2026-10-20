import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach } from 'vitest'
import { runGit } from '../src/core/exec'
import { GitRepository } from '../src/core/repository'

const created: string[] = []

afterEach(() => {
  while (created.length) rmSync(created.pop()!, { recursive: true, force: true })
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
