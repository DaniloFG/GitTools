import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

// Issue #143: .claude/hooks/origin-head.sh define refs/remotes/origin/HEAD no SessionStart. Em contêiner novo o clone
// não traz esse símbolo e as skills code-review e security-review quebram. Os testes usam git de verdade: um repositório
// de trabalho com `origin` apontando para um bare local.

const hook = fileURLToPath(new URL('../.claude/hooks/origin-head.sh', import.meta.url))

// Identidade fixa para o commit de teste; sem ela o commit-tree falha em máquina sem git configurado.
const IDENTIDADE = {
  GIT_AUTHOR_NAME: 'teste',
  GIT_AUTHOR_EMAIL: 'teste@exemplo.com',
  GIT_COMMITTER_NAME: 'teste',
  GIT_COMMITTER_EMAIL: 'teste@exemplo.com',
}

let criados: string[] = []

afterEach(() => {
  for (const dir of criados) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  criados = []
})

// Processo assíncrono: no Git Bash do Windows, a chamada síncrona segura o worker do vitest tempo suficiente para o RPC
// onTaskUpdate estourar. Não rejeita por status diferente de zero (os testes conferem o código de saída).
function executar(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {}) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const filho = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    filho.stdout.setEncoding('utf8')
    filho.stderr.setEncoding('utf8')
    filho.stdout.on('data', (pedaco: string) => {
      stdout += pedaco
    })
    filho.stderr.on('data', (pedaco: string) => {
      stderr += pedaco
    })
    filho.stdin.on('error', () => {})
    filho.on('error', (erro) => resolve({ status: null, stdout, stderr: stderr + erro.message }))
    filho.on('close', (status) => resolve({ status, stdout, stderr }))
    filho.stdin.end('')
  })
}

// O ambiente herdado pode vir de um git hook (GIT_DIR) ou de outra sessão (CLAUDE_PROJECT_DIR): os testes não podem
// depender disso, então removem as duas variáveis antes de aplicar o que cada caso pede.
function ambiente(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...IDENTIDADE, ...extra }
  delete env.GIT_DIR
  if (!('CLAUDE_PROJECT_DIR' in extra)) delete env.CLAUDE_PROJECT_DIR
  return env
}

function novoTmp(prefixo: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefixo))
  criados.push(dir)
  return dir
}

const git = (repo: string, ...args: string[]) => executar('git', ['-C', repo, ...args], { env: ambiente() })

// Commit vazio com a árvore vazia: basta um objeto de commit para apontar uma ref remota.
async function commit(repo: string): Promise<string> {
  const arvore = (await git(repo, 'write-tree')).stdout.trim()
  const r = await executar('git', ['-C', repo, 'commit-tree', arvore, '-m', 'base'], { env: ambiente() })
  return r.stdout.trim()
}

// Repositório de trabalho com `origin` apontando para um bare local. `ramosRemotos` cria as refs remotas com update-ref,
// sem rede; o bare fica vazio, então um fetch dele não traz nada, a menos que o caso faça um push antes.
async function projeto(ramosRemotos: string[] = []) {
  const origem = novoTmp('gittools-originhead-origem-')
  const proj = novoTmp('gittools-originhead-proj-')
  await executar('git', ['init', '-q', '--bare', origem], { env: ambiente() })
  await executar('git', ['init', '-q', proj], { env: ambiente() })
  await git(proj, 'remote', 'add', 'origin', origem)
  const sha = await commit(proj)
  for (const ramo of ramosRemotos) await git(proj, 'update-ref', `refs/remotes/origin/${ramo}`, sha)
  return { proj, origem, sha }
}

function rodar(proj: string) {
  return executar('bash', [hook], { env: ambiente({ CLAUDE_PROJECT_DIR: proj }) })
}

// Valor do símbolo refs/remotes/origin/HEAD, ou null se ele não existe.
async function origemHead(proj: string): Promise<string | null> {
  const r = await git(proj, 'symbolic-ref', '-q', 'refs/remotes/origin/HEAD')
  return r.status === 0 ? r.stdout.trim() : null
}

describe('origin-head: define refs/remotes/origin/HEAD sem rede', () => {
  it('(a) sem origin/HEAD e com origin/develop, aponta para develop', async () => {
    const { proj } = await projeto(['develop'])
    expect(await origemHead(proj)).toBeNull()
    const r = await rodar(proj)
    expect(r.status).toBe(0)
    expect(await origemHead(proj)).toBe('refs/remotes/origin/develop')
  })

  it('(b) develop ausente e só main remoto, aponta para main', async () => {
    const { proj } = await projeto(['main'])
    const r = await rodar(proj)
    expect(r.status).toBe(0)
    expect(await origemHead(proj)).toBe('refs/remotes/origin/main')
  })

  it('a ordem de preferência é develop, homolog, main: sem develop, homolog vence main', async () => {
    const { proj } = await projeto(['main', 'homolog'])
    const r = await rodar(proj)
    expect(r.status).toBe(0)
    expect(await origemHead(proj)).toBe('refs/remotes/origin/homolog')
  })

  it('(c) origin/HEAD já existe (apontando para homolog): não muda, mesmo com develop presente', async () => {
    const { proj } = await projeto(['develop', 'homolog'])
    await git(proj, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/homolog')
    const r = await rodar(proj)
    expect(r.status).toBe(0)
    expect(await origemHead(proj)).toBe('refs/remotes/origin/homolog')
  })

  it('(d) nenhuma ref remota e fetch impossível: sai 0, avisa no stderr e não cria o símbolo', async () => {
    // Origem que não existe: o fetch falha de verdade, sem depender de rede.
    const { proj } = await projeto([])
    await git(proj, 'remote', 'set-url', 'origin', join(novoTmp('gittools-originhead-sumido-'), 'nao-existe'))
    const r = await rodar(proj)
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('aviso')
    expect(await origemHead(proj)).toBeNull()
  })

  it('(e) nenhuma ref remota, mas origin tem develop: o fetch de develop cria a ref e aponta para ela', async () => {
    const { proj, origem, sha } = await projeto([])
    await git(proj, 'push', '-q', origem, `${sha}:refs/heads/develop`)
    const r = await rodar(proj)
    expect(r.status).toBe(0)
    expect(await origemHead(proj)).toBe('refs/remotes/origin/develop')
  })

  it('sem CLAUDE_PROJECT_DIR, usa o diretório atual', async () => {
    const { proj } = await projeto(['develop'])
    const r = await executar('bash', [hook], { env: ambiente(), cwd: proj })
    expect(r.status).toBe(0)
    expect(await origemHead(proj)).toBe('refs/remotes/origin/develop')
  })

  it('rodar duas vezes dá o mesmo resultado (idempotente)', async () => {
    const { proj } = await projeto(['develop'])
    await rodar(proj)
    const r = await rodar(proj)
    expect(r.status).toBe(0)
    expect(await origemHead(proj)).toBe('refs/remotes/origin/develop')
  })
})
