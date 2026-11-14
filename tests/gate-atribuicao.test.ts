import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Gate de atribuição de IA (issue #252): .claude/hooks/gate-atribuicao.sh barra (exit 2) commit, PR e comentário com
// trailer Co-Authored-By/Claude-Session, rodapé "Generated with [Claude Code]" ou link claude.ai/code, que o ambiente
// da sessão injeta contra a regra do CLAUDE.md. Prosa que só cita o termo (entre crases, sem dois-pontos) passa.

const gate = fileURLToPath(new URL('../.claude/hooks/gate-atribuicao.sh', import.meta.url))
const settingsPath = fileURLToPath(new URL('../.claude/settings.json', import.meta.url))

let dir = ''

// Processo assíncrono (mesmo motivo de gate-issue.test.ts: no Git Bash do Windows a chamada síncrona segura o worker
// do vitest tempo suficiente para o RPC estourar). Não rejeita por status diferente de zero; erro de spawn vira null.
function executar(cmd: string, args: string[], opts: { input?: string } = {}) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const filho = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
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
    // O filho pode sair sem ler a entrada: o EPIPE no stdin não pode derrubar o teste.
    filho.stdin.on('error', () => {})
    filho.on('error', (erro) => resolve({ status: null, stdout, stderr: stderr + erro.message }))
    filho.on('close', (status) => resolve({ status, stdout, stderr }))
    filho.stdin.end(opts.input ?? '')
  })
}

beforeAll(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'gittools-gateatrib-')))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function rodar(entrada: unknown) {
  const r = await executar('bash', [gate], { input: typeof entrada === 'string' ? entrada : JSON.stringify(entrada) })
  return { code: r.status, stderr: r.stderr }
}

const bash = (command: string) => rodar({ tool_name: 'Bash', cwd: dir, tool_input: { command } })
const mcp = (tool: string, tool_input: Record<string, unknown>) => rodar({ tool_name: `mcp__github__${tool}`, tool_input })

describe('gate-atribuicao: reprova', () => {
  it('git commit com trailer Co-Authored-By em -m', async () => {
    const r = await bash('git commit -m "x" -m "Co-Authored-By: A <a@b>"')
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DE ATRIBUIÇÃO')
    expect(r.stderr).toContain('CLAUDE.md')
  })

  it('heredoc com Claude-Session no próprio comando, com LF e com CRLF', async () => {
    const corpo = "git commit -F - <<'EOF'\ntitulo\n\nClaude-Session: https://x/y\nEOF"
    expect((await bash(corpo)).code).toBe(2)
    expect((await bash(corpo.replace(/\n/g, '\r\n'))).code).toBe(2)
  })

  it('git -c ... commit --trailer "Co-authored-by: y" (minúsculas, trailer depois de aspas)', async () => {
    expect((await bash('git -c user.name=x commit --trailer "Co-authored-by: y"')).code).toBe(2)
    expect((await bash('git commit --trailer=Co-authored-by: y')).code).toBe(2)
  })

  it('operador colado ao git: cd x&&git commit, a;git commit e (git commit)', async () => {
    const trailer = '-m "Co-Authored-By: y"'
    expect((await bash(`cd x&&git commit ${trailer}`)).code).toBe(2)
    expect((await bash(`git add .;git commit ${trailer}`)).code).toBe(2)
    expect((await bash(`(git commit ${trailer})`)).code).toBe(2)
    expect((await bash(`true||git commit ${trailer}`)).code).toBe(2)
    expect((await bash(`echo a|git commit ${trailer}`)).code).toBe(2)
    expect((await bash('cd x&&git status;git log|grep "Co-Authored-By:"')).code).toBe(0)
  })

  it('--trailer com "=" no lugar de ":" (o git aceita)', async () => {
    expect((await bash('git commit --trailer Co-authored-by=Nome')).code).toBe(2)
    expect((await bash('git commit --trailer "Claude-Session=x"')).code).toBe(2)
  })

  it('-F colado ao nome do arquivo (git commit -Fcolado.txt)', async () => {
    writeFileSync(join(dir, 'colado.txt'), 'titulo\n\nCo-Authored-By: Z <z@z>\n')
    expect((await bash('git commit -Fcolado.txt')).code).toBe(2)
  })

  it('git commit -F arquivo, com o trailer dentro do arquivo (CRLF)', async () => {
    writeFileSync(join(dir, 'msg.txt'), 'titulo\r\n\r\nCo-Authored-By: Z <z@z>\r\n')
    expect((await bash('git commit -F msg.txt')).code).toBe(2)
    expect((await bash('git commit --file msg.txt')).code).toBe(2)
    expect((await bash('git commit --file=msg.txt')).code).toBe(2)
    expect((await bash("git commit -F 'msg.txt'")).code).toBe(2)
    expect((await bash(`git commit -F ${join(dir, 'msg.txt')}`)).code).toBe(2)
  })

  it('gh pr create --body-file com "Generated with [Claude Code]"', async () => {
    writeFileSync(join(dir, 'corpo.md'), '## Resumo\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n')
    expect((await bash('gh pr create --title t --body-file corpo.md')).code).toBe(2)
    expect((await bash('gh pr create --title t --body-file=corpo.md')).code).toBe(2)
  })

  it('create_pull_request com link claude.ai/code no corpo', async () => {
    const r = await mcp('create_pull_request', { title: 't', body: 'feito\n\nhttps://claude.ai/code/session_x' })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('claude.ai/code')
  })

  it('update_pull_request com "Generated by [Claude Code]"', async () => {
    expect((await mcp('update_pull_request', { body: 'texto\n\nGenerated by [Claude Code]' })).code).toBe(2)
  })

  it('merge_pull_request com trailer em commit_message', async () => {
    expect((await mcp('merge_pull_request', { commit_message: 'merge\n\nCo-Authored-By: A <a@b>' })).code).toBe(2)
  })

  it('push_files e create_or_update_file com trailer em message', async () => {
    expect((await mcp('push_files', { message: 'x\n\nClaude-Session: https://x' })).code).toBe(2)
    expect((await mcp('create_or_update_file', { message: 'x\n\nCo-Authored-By: A <a@b>' })).code).toBe(2)
  })

  it('add_issue_comment com o rodapé _Generated by [Claude Code](https://claude.ai/code)_', async () => {
    expect((await mcp('add_issue_comment', { body: 'evidência\n\n_Generated by [Claude Code](https://claude.ai/code)_' })).code).toBe(2)
  })

  it('gh api que escreve: -f, -F campo=@arquivo, --input e -X POST', async () => {
    writeFileSync(join(dir, 'comentario.md'), 'ok\r\n\r\nGenerated by [Claude Code]\r\n')
    expect((await bash('gh api repos/o/r/issues/1/comments -f body="Co-Authored-By: A <a@b>"')).code).toBe(2)
    expect((await bash('gh api repos/o/r/issues/1/comments -F body=@comentario.md')).code).toBe(2)
    expect((await bash('gh api repos/o/r/issues/1/comments --input comentario.md')).code).toBe(2)
    expect((await bash('gh api -X patch repos/o/r/pulls/1 --raw-field body=https://claude.ai/code/s')).code).toBe(2)
  })

  it('corpo de PR com `claude.ai/code` entre crases: rodapé e link são barrados até em prosa', async () => {
    const r = await mcp('create_pull_request', { title: 't', body: 'o gate barra o link `claude.ai/code` no corpo' })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('parafraseie')
  })

  it('JSON inválido numa chamada mcp__github__create_pull_request bloqueia', async () => {
    const r = await rodar('{"tool_name":"mcp__github__create_pull_request","tool_input":{')
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('JSON inválido')
  })
})

describe('gate-atribuicao: passa', () => {
  it('commit limpo', async () => {
    expect((await bash('git commit -m "corrige o gate" -m "porque sim"')).code).toBe(0)
  })

  it('commit que explica a regra: termo entre crases e sem dois-pontos', async () => {
    expect((await bash('git commit -m "barra `Co-Authored-By` e `Claude-Session` no commit"')).code).toBe(0)
    expect((await bash('git commit -m "o trailer `Co-Authored-By` e `Claude-Session`; sem = nem :"')).code).toBe(0)
  })

  it('echo com trailer, sem git nem gh', async () => {
    expect((await bash('echo "Co-Authored-By: x"')).code).toBe(0)
  })

  it('git log --grep e git status (sem commit/merge/tag gravando mensagem)', async () => {
    expect((await bash("git log --grep='Co-Authored-By'")).code).toBe(0)
    expect((await bash('git status')).code).toBe(0)
  })

  it('leituras que só procuram o termo: git log | grep, gh pr list | grep, gh api GET', async () => {
    expect((await bash("git log --format=%B | grep 'Co-Authored-By:'")).code).toBe(0)
    expect((await bash("gh pr list | grep 'Generated by [Claude Code]'")).code).toBe(0)
    expect((await bash('gh api repos/o/r/pulls/1')).code).toBe(0)
    expect((await bash("gh api repos/o/r/pulls/1 -X GET --jq .body | grep 'claude.ai/code'")).code).toBe(0)
  })

  it('push_files varre só message: o conteúdo dos arquivos do repositório não conta', async () => {
    const r = await mcp('push_files', { message: 'docs: explica a regra', files: [{ path: 'a.md', content: 'Co-Authored-By: x' }] })
    expect(r.code).toBe(0)
    expect((await mcp('create_or_update_file', { message: 'm', content: 'Generated with [Claude Code]' })).code).toBe(0)
  })

  it('gh api -F campo=@arquivo inexistente e gh pr create sem texto de atribuição', async () => {
    expect((await bash('gh api repos/o/r/issues/1/comments -F body=@nao-existe.md')).code).toBe(0)
    expect((await bash('gh pr create --title t --body-file nao-existe.md')).code).toBe(0)
  })

  it('create_pull_request com corpo limpo', async () => {
    expect((await mcp('create_pull_request', { title: 'fix: gate', body: 'Refs #252\n\nO que mudou.' })).code).toBe(0)
  })

  it('update_pull_request só com title (body ausente)', async () => {
    expect((await mcp('update_pull_request', { title: 'novo título' })).code).toBe(0)
  })

  it('ferramenta Read', async () => {
    expect((await rodar({ tool_name: 'Read', tool_input: { file_path: '/tmp/x' } })).code).toBe(0)
  })

  it('-F para arquivo inexistente com comando limpo', async () => {
    expect((await bash('git commit -F nao-existe.txt')).code).toBe(0)
    expect((await bash('git commit -F -')).code).toBe(0)
  })
})

describe('gate-atribuicao: registro', () => {
  it('settings.json liga o hook em PreToolUse para Bash e para as ferramentas MCP que gravam texto', () => {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8').replace(/\r\n/g, '\n')) as {
      hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] }
    }
    const entrada = settings.hooks.PreToolUse.find((e) => e.hooks.some((h) => h.command.endsWith('/.claude/hooks/gate-atribuicao.sh')))
    expect(entrada).toBeDefined()
    const ferramentas = (entrada?.matcher ?? '').split('|')
    for (const f of [
      'Bash',
      'mcp__github__create_pull_request',
      'mcp__github__update_pull_request',
      'mcp__github__add_issue_comment',
    ]) {
      expect(ferramentas).toContain(f)
    }
  })
})
