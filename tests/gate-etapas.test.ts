import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'

// Gate de triagem (CLAUDE.md): .claude/hooks/gate-etapas.sh bloqueia o gt-escritor sem HANDOFF nem triagem.local.
// Fábrica paralela (#199): a triagem é a do worktree em que a sessão roda (cwd do hook), não a do projeto.

const gate = fileURLToPath(new URL('../.claude/hooks/gate-etapas.sh', import.meta.url))

function executar(cmd: string, args: string[], opts: { input?: string; env?: NodeJS.ProcessEnv; cwd?: string } = {}) {
  return new Promise<{ status: number | null; stderr: string }>((resolve) => {
    const filho = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    filho.stderr.setEncoding('utf8')
    filho.stderr.on('data', (p: string) => {
      stderr += p
    })
    filho.stdin.on('error', () => {})
    filho.on('error', (e) => resolve({ status: null, stderr: e.message }))
    filho.on('close', (status) => resolve({ status, stderr }))
    filho.stdin.end(opts.input ?? '')
  })
}

let projeto = ''
let fora = ''
let wt = ''

const git = (cwd: string, ...args: string[]) => executar('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd })

beforeEach(async () => {
  projeto = mkdtempSync(join(tmpdir(), 'gittools-gateetapas-proj-'))
  fora = mkdtempSync(join(tmpdir(), 'gittools-gateetapas-fora-'))
  wt = join(fora, 'wt')
  await git(projeto, 'init', '-q')
  await git(projeto, 'commit', '-q', '--allow-empty', '-m', 'base')
  expect((await git(projeto, 'worktree', 'add', '-q', '-b', 'fix/1-x', wt)).status).toBe(0)
  mkdirSync(join(projeto, '.claude'), { recursive: true })
  mkdirSync(join(wt, '.claude'), { recursive: true })
  return () => {
    rmSync(projeto, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    rmSync(fora, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

const escritor = (cwd?: string, subagent_type = 'gt-escritor') =>
  executar('bash', [gate], {
    input: JSON.stringify({ tool_name: 'Agent', ...(cwd ? { cwd } : {}), tool_input: { subagent_type, prompt: 'x' } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projeto },
  })

describe('gate-etapas', () => {
  it('sem triagem nem HANDOFF bloqueia o gt-escritor, com a mensagem do modo fábrica', async () => {
    const r = await escritor(projeto)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('GATE DE ETAPAS')
    expect(r.stderr).not.toContain('espere o "pode seguir"')
  })

  it('outros agentes passam', async () => {
    expect((await escritor(projeto, 'gt-leitor')).status).toBe(0)
  })

  it('triagem pequena/media libera; "grande" não', async () => {
    writeFileSync(join(projeto, '.claude', 'triagem.local'), 'grande tudo\n')
    expect((await escritor(projeto)).status).toBe(2)
    writeFileSync(join(projeto, '.claude', 'triagem.local'), 'media ajuste\n')
    expect((await escritor(projeto)).status).toBe(0)
  })

  it('HANDOFF libera', async () => {
    mkdirSync(join(projeto, 'docs'), { recursive: true })
    writeFileSync(join(projeto, 'docs', 'HANDOFF.md'), '# x\n')
    expect((await escritor(projeto)).status).toBe(0)
  })

  it('a triagem é por worktree: a do projeto não vale no worktree e vice-versa', async () => {
    writeFileSync(join(projeto, '.claude', 'triagem.local'), 'pequena a\n')
    expect((await escritor(wt)).status).toBe(2)
    expect((await escritor(projeto)).status).toBe(0)
    writeFileSync(join(wt, '.claude', 'triagem.local'), 'pequena b\n')
    expect((await escritor(wt)).status).toBe(0)
    rmSync(join(projeto, '.claude', 'triagem.local'))
    expect((await escritor(projeto)).status).toBe(2)
    expect((await escritor(wt)).status).toBe(0)
  })

  it('sem cwd no JSON, vale o projeto', async () => {
    writeFileSync(join(projeto, '.claude', 'triagem.local'), 'pequena a\n')
    expect((await escritor()).status).toBe(0)
  })
})
