import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Gate da main (issue #100): o hook .claude/hooks/gate-main.sh bloqueia (exit 2) merge, auto-merge e push na main.
// O `gh` de verdade nunca é chamado: um `gh` falso no início do PATH responde pela base conforme o número do PR.

const script = fileURLToPath(new URL('../.claude/hooks/gate-main.sh', import.meta.url))

let dir = ''
let ghLog = ''

// 1 -> develop, 2 -> homolog, 3 -> main, qualquer outro número (ex.: 9) -> o gh falha. Cada chamada fica no log.
const ghFalso = `#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
if [ "$1" = api ]; then
  case "$2" in
    */pulls/1) echo develop; exit 0 ;;
    */pulls/2) echo homolog; exit 0 ;;
    */pulls/3) echo main; exit 0 ;;
  esac
fi
exit 1
`

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'gittools-gatemain-'))
  ghLog = join(dir, 'gh.log')
  writeFileSync(join(dir, 'gh'), ghFalso)
  chmodSync(join(dir, 'gh'), 0o755)
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

beforeEach(() => {
  rmSync(ghLog, { force: true })
})

function rodar(toolName: string, toolInput: Record<string, unknown>) {
  const r = spawnSync('bash', [script], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`, GH_LOG: ghLog },
  })
  return { code: r.status, stderr: r.stderr }
}

const bash = (command: string) => rodar('Bash', { command })
const mcp = (nome: string, entrada: Record<string, unknown>) => rodar(`mcp__github__${nome}`, entrada)
const pr = (numero: number) => ({ owner: 'o', repo: 'r', pullNumber: numero })

describe('gate-main: GitHub MCP', () => {
  it.each([1, 2])('merge do PR %i (base develop/homolog) passa', (n) => {
    expect(mcp('merge_pull_request', pr(n)).code).toBe(0)
  })

  it('merge do PR com base main bloqueia, com mensagem em português', () => {
    const r = mcp('merge_pull_request', pr(3))
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DA MAIN')
    expect(r.stderr).toContain('main')
  })

  it('auto-merge do PR com base main bloqueia; com base develop passa', () => {
    expect(mcp('enable_pr_auto_merge', pr(3)).code).toBe(2)
    expect(mcp('enable_pr_auto_merge', pr(1)).code).toBe(0)
  })

  it('falha fechada: gh que falha (PR 9) bloqueia e diz que não confirmou a base', () => {
    const r = mcp('merge_pull_request', pr(9))
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('não foi possível confirmar a base')
  })

  it('falha fechada: número do PR ausente bloqueia sem chamar o gh', () => {
    expect(mcp('merge_pull_request', { owner: 'o', repo: 'r' }).code).toBe(2)
    expect(existsSync(ghLog)).toBe(false)
  })

  it.each(['push_files', 'create_or_update_file', 'delete_file'])('%s: branch main bloqueia, feature/x passa', (nome) => {
    expect(mcp(nome, { owner: 'o', repo: 'r', branch: 'main' }).code).toBe(2)
    expect(mcp(nome, { owner: 'o', repo: 'r', branch: 'refs/heads/main' }).code).toBe(2)
    expect(mcp(nome, { owner: 'o', repo: 'r', branch: 'feature/x' }).code).toBe(0)
    expect(mcp(nome, { owner: 'o', repo: 'r', branch: 'feature/main-menu' }).code).toBe(0)
  })

  it('update_pull_request: trocar a base para main bloqueia; outra base ou só o título passa', () => {
    expect(mcp('update_pull_request', { ...pr(1), base: 'main' }).code).toBe(2)
    expect(mcp('update_pull_request', { ...pr(1), base: 'homolog' }).code).toBe(0)
    expect(mcp('update_pull_request', { ...pr(1), title: 'novo título' }).code).toBe(0)
  })
})

describe('gate-main: git push no Bash', () => {
  it.each([
    'git push origin main',
    'git push origin HEAD:main',
    'git push origin HEAD:refs/heads/main',
    'git push origin :refs/heads/main',
    'git push origin +feature/x:main',
    'git push --mirror origin',
    'git push --all origin',
    'git -C /tmp/repo push origin main',
    'cd /tmp && git push origin "HEAD:main"',
  ])('bloqueia: %s', (comando) => {
    expect(bash(comando).code).toBe(2)
  })

  it.each([
    'git push -u origin feature/maintenance',
    'git push origin ccr-abc',
    'git push origin feature/main-menu',
    'git push origin HEAD:develop',
    'git push origin homolog',
    'git log --oneline main',
    'git status && git diff origin/main',
    'git commit -m "mensagem sobre git push origin main"',
  ])('passa: %s', (comando) => {
    expect(bash(comando).code).toBe(0)
  })
})

describe('gate-main: gh no Bash', () => {
  it('gh pr merge: base main bloqueia; develop e homolog passam', () => {
    expect(bash('gh pr merge 3').code).toBe(2)
    expect(bash('gh pr merge 3 --auto --squash').code).toBe(2)
    expect(bash('gh pr merge 1').code).toBe(0)
    expect(bash('gh pr merge 2 --auto').code).toBe(0)
  })

  it('gh pr merge pela URL do PR confere a base', () => {
    expect(bash('gh pr merge https://github.com/o/r/pull/3').code).toBe(2)
    expect(bash('gh pr merge https://github.com/o/r/pull/1').code).toBe(0)
  })

  it('falha fechada: gh pr merge cujo gh falha (PR 9) ou sem número bloqueia', () => {
    expect(bash('gh pr merge 9').code).toBe(2)
    expect(bash('gh pr merge').code).toBe(2)
    expect(bash('gh pr merge minha-branch --auto').code).toBe(2)
  })

  it('gh api PUT/POST em /pulls/N/merge e auto_merge confere a base', () => {
    expect(bash('gh api -X PUT repos/o/r/pulls/3/merge').code).toBe(2)
    expect(bash('gh api --method POST repos/o/r/pulls/3/ccr/auto_merge').code).toBe(2)
    expect(bash('gh api -XPUT repos/o/r/pulls/1/merge').code).toBe(0)
    expect(bash('gh api -X PUT repos/o/r/pulls/9/merge').code).toBe(2)
  })

  it('gh api que muda a base para main bloqueia', () => {
    expect(bash('gh api -X PATCH repos/o/r/pulls/1 -f base=main').code).toBe(2)
    expect(bash(`gh api -X PATCH repos/o/r/pulls/1 -f base=refs/heads/main`).code).toBe(2)
    expect(bash('gh api -X PATCH repos/o/r/pulls/1 -f base=homolog').code).toBe(0)
  })

  it('gh só de leitura passa, sem chamar o gh falso', () => {
    for (const comando of ['gh pr view 3', 'gh api repos/o/r/pulls/3', 'gh api -X GET repos/o/r/pulls -f base=main', 'gh pr list']) {
      expect(bash(comando).code).toBe(0)
    }
    expect(existsSync(ghLog)).toBe(false)
  })
})

describe('gate-main: caminho comum', () => {
  it('outra ferramenta passa', () => {
    expect(rodar('Read', { file_path: '/tmp/x' }).code).toBe(0)
  })

  it('comando Bash que não é de git nem de gh passa sem chamar o gh', () => {
    expect(bash('ls -la && npm run typecheck').code).toBe(0)
    expect(existsSync(ghLog)).toBe(false)
  })
})
