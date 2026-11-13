import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Gate de issue (issue #102): .claude/hooks/gate-issue.sh bloqueia (exit 2) escrita sem issue ativa, e
// .claude/hooks/lembrete-issue.sh injeta o lembrete a cada prompt. O `gh` de verdade nunca é chamado: um `gh`
// falso no início do PATH responde pelo número da issue.

const gate = fileURLToPath(new URL('../.claude/hooks/gate-issue.sh', import.meta.url))
const lembrete = fileURLToPath(new URL('../.claude/hooks/lembrete-issue.sh', import.meta.url))

let bin = ''
let ghLog = ''
let projeto = ''

// 5 -> aberta, 6 -> fechada, 8 -> 404, qualquer outro (ex.: 9) -> falha de rede (exit 1 sem 404).
const ghFalso = `#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
if [ "$1" = api ]; then
  case "$2" in
    */issues/5) echo open; exit 0 ;;
    */issues/6) echo closed; exit 0 ;;
    */issues/8) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;
  esac
fi
echo "error connecting to api.github.com" >&2
exit 1
`

// Processo assíncrono: no Git Bash do Windows, a chamada síncrona de processo segura o worker do vitest tempo
// suficiente para o RPC onTaskUpdate estourar. Com spawn o laço de eventos fica livre entre um passo e outro. Não
// rejeita por status diferente de zero (os testes conferem o código de saída); erro de spawn vira status null.
function executar(cmd: string, args: string[], opts: { input?: string; env?: NodeJS.ProcessEnv; cwd?: string } = {}) {
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
    // O filho pode sair sem ler a entrada: o EPIPE no stdin não pode derrubar o teste (a versão síncrona também ignorava).
    filho.stdin.on('error', () => {})
    filho.on('error', (erro) => resolve({ status: null, stdout, stderr: stderr + erro.message }))
    filho.on('close', (status) => resolve({ status, stdout, stderr }))
    filho.stdin.end(opts.input ?? '')
  })
}

beforeAll(() => {
  bin = mkdtempSync(join(tmpdir(), 'gittools-gateissue-bin-'))
  ghLog = join(bin, 'gh.log')
  writeFileSync(join(bin, 'gh'), ghFalso)
  chmodSync(join(bin, 'gh'), 0o755)
})

afterAll(() => {
  rmSync(bin, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

// Projeto novo por teste: repositório com `origin` (de onde o hook deriva dono/repo) e sem marcador nem HANDOFF.
beforeEach(async () => {
  rmSync(ghLog, { force: true })
  projeto = mkdtempSync(join(tmpdir(), 'gittools-gateissue-proj-'))
  mkdirSync(join(projeto, '.claude'))
  mkdirSync(join(projeto, 'docs'))
  // Em sequência: o remote add só faz sentido depois que o repositório existe.
  await executar('git', ['init', '-q', projeto])
  await executar('git', ['-C', projeto, 'remote', 'add', 'origin', 'https://github.com/dono/repo.git'])
  return () => rmSync(projeto, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

const marcador = (conteudo: string) => writeFileSync(join(projeto, '.claude', 'issue.local'), conteudo)
const handoff = (conteudo: string) => writeFileSync(join(projeto, 'docs', 'HANDOFF.md'), conteudo)

async function rodar(script: string, entrada: unknown) {
  const r = await executar('bash', [script], {
    input: JSON.stringify(entrada),
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, GH_LOG: ghLog, CLAUDE_PROJECT_DIR: projeto },
  })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

const escrever = (file_path: string, tool_name = 'Write') => rodar(gate, { tool_name, tool_input: { file_path, content: 'x' } })
// Caminho com ".." que volta ao projeto, montado a partir do tmp real (no Windows não existe "/tmp" nem "projeto.slice(1)").
// Concatenação de propósito: join() já normalizaria o ".." e o hook não veria o caminho torto.
const comVolta = () => `${dirname(projeto)}/../${basename(dirname(projeto))}/${basename(projeto)}/src/a.ts`
const escreverNoProjeto = () => escrever(join(projeto, 'src', 'a.ts'))
const agente = (subagent_type: string) => rodar(gate, { tool_name: 'Agent', tool_input: { subagent_type, prompt: 'faça' } })

describe('gate-issue: sem issue ativa', () => {
  it('sem marcador e sem HANDOFF, Write no projeto bloqueia com a mensagem do gate', async () => {
    const r = await escreverNoProjeto()
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DE ISSUE')
    expect(r.stderr).toContain('.claude/issue.local')
    expect(r.stderr).toContain('mcp__github__issue_write')
  })

  it('Edit e NotebookEdit também bloqueiam (este com notebook_path)', async () => {
    expect((await escrever(join(projeto, 'src', 'a.ts'), 'Edit')).code).toBe(2)
    const r = await rodar(gate, { tool_name: 'NotebookEdit', tool_input: { notebook_path: join(projeto, 'n.ipynb') } })
    expect(r.code).toBe(2)
  })

  it('caminho relativo e ".." que voltam ao projeto continuam bloqueados', async () => {
    expect((await escrever('src/a.ts')).code).toBe(2)
    // Concatenação de propósito: join() já normalizaria o ".." e o hook não veria o caminho torto.
    expect((await escrever(comVolta())).code).toBe(2)
  })

  it('sem realpath -m (BSD/macOS), ".." que volta ao projeto continua bloqueado', async () => {
    // O realpath do macOS não aceita -m: o hook não pode depender dele para normalizar o caminho.
    const falso = join(bin, 'realpath')
    writeFileSync(falso, '#!/usr/bin/env bash\necho "realpath: illegal option -- m" >&2\nexit 1\n')
    chmodSync(falso, 0o755)
    try {
      expect((await escrever(comVolta())).code).toBe(2)
      expect((await escrever('src/../src/a.ts')).code).toBe(2)
      expect((await escrever(`${projeto}/../fora/a.ts`)).code).toBe(0)
    } finally {
      rmSync(falso, { force: true })
    }
  })

  it('HANDOFF sem #N e sem marcador bloqueia', async () => {
    handoff('# Plano\n\n| Etapa | Issue |\n| --- | --- |\n| 1 | a criar |\n')
    expect((await escreverNoProjeto()).code).toBe(2)
  })

  it('marcador sem #N na primeira linha bloqueia, mesmo com #N nas outras linhas', async () => {
    marcador('sem número\n#5\n')
    expect((await escreverNoProjeto()).code).toBe(2)
    expect(existsSync(ghLog)).toBe(false)
  })

  it('gt-escritor sem issue bloqueia; gt-leitor passa', async () => {
    expect((await agente('gt-escritor')).code).toBe(2)
    expect((await agente('gt-leitor')).code).toBe(0)
  })
})

describe('gate-issue: issue ativa', () => {
  it('HANDOFF com #7 e sem marcador passa, sem chamar o gh', async () => {
    handoff('| Etapa | Issue |\n| --- | --- |\n| 1 | #7 |\n')
    expect((await escreverNoProjeto()).code).toBe(0)
    expect((await agente('gt-escritor')).code).toBe(0)
    expect(existsSync(ghLog)).toBe(false)
  })

  it('marcador #5 com a issue aberta passa', async () => {
    marcador('#5 ajuste do botão\n')
    expect((await escreverNoProjeto()).code).toBe(0)
    expect((await agente('gt-escritor')).code).toBe(0)
  })

  it('a consulta usa dono/repo do origin e o número do marcador', async () => {
    marcador('#5\n')
    await escreverNoProjeto()
    expect(readFileSync(ghLog, 'utf8')).toContain('api repos/dono/repo/issues/5 --jq .state')
  })

  it('marcador #6 com a issue fechada bloqueia, dizendo que está inexistente ou fechada', async () => {
    marcador('#6\n')
    const r = await escreverNoProjeto()
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('inexistente ou fechada')
    expect((await agente('gt-escritor')).code).toBe(2)
  })

  it('marcador #8 com 404 bloqueia', async () => {
    marcador('#8\n')
    const r = await escreverNoProjeto()
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('inexistente ou fechada')
  })

  it('falha de rede do gh (exit 1 sem 404) não bloqueia: só avisa no stderr', async () => {
    marcador('#9\n')
    const r = await escreverNoProjeto()
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('não foi possível confirmar a issue')
  })

  it('vários números: basta um aberto para passar; todos mortos bloqueia', async () => {
    marcador('#6 #5\n')
    expect((await escreverNoProjeto()).code).toBe(0)
    marcador('#6 #8\n')
    expect((await escreverNoProjeto()).code).toBe(2)
  })

  it('sem origin derivável, a verificação no GitHub é pulada e o marcador vale', async () => {
    await executar('git', ['-C', projeto, 'remote', 'remove', 'origin'])
    marcador('#6\n')
    expect((await escreverNoProjeto()).code).toBe(0)
    expect(existsSync(ghLog)).toBe(false)
  })

  it('o marcador vale mais que o HANDOFF: marcador fechado bloqueia mesmo com HANDOFF com #N', async () => {
    handoff('| 1 | #7 |\n')
    marcador('#6\n')
    expect((await escreverNoProjeto()).code).toBe(2)
  })
})

describe('gate-issue: o que passa sem issue', () => {
  it('Write fora do projeto (/tmp) passa', async () => {
    expect((await escrever('/tmp/x')).code).toBe(0)
  })

  it('Write nos marcadores .claude/issue.local e .claude/triagem.local passa (senão não há como registrar a issue)', async () => {
    expect((await escrever(join(projeto, '.claude', 'issue.local'))).code).toBe(0)
    expect((await escrever(join(projeto, '.claude', 'triagem.local'))).code).toBe(0)
  })

  it('outro arquivo de .claude/ continua bloqueado', async () => {
    expect((await escrever(join(projeto, '.claude', 'settings.json'))).code).toBe(2)
  })

  it('outras ferramentas passam sem abrir o jq nem o gh', async () => {
    expect((await rodar(gate, { tool_name: 'Read', tool_input: { file_path: join(projeto, 'a.ts') } })).code).toBe(0)
    expect((await rodar(gate, { tool_name: 'Bash', tool_input: { command: 'ls' } })).code).toBe(0)
    expect(existsSync(ghLog)).toBe(false)
  })
})

describe('lembrete-issue', () => {
  it('imprime JSON válido de UserPromptSubmit com o lembrete obrigatório', async () => {
    const r = await rodar(lembrete, { prompt: 'ajusta o botão de commit' })
    expect(r.code).toBe(0)
    const saida = JSON.parse(r.stdout)
    expect(saida.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit')
    expect(saida.hookSpecificOutput.additionalContext).toContain('OBRIGATÓRIO')
    expect(saida.hookSpecificOutput.additionalContext).toContain('.claude/issue.local')
    expect(saida.hookSpecificOutput.additionalContext).toContain('.claude/rules/github.md')
  })

  it('prompt que começa com "[SYSTEM NOTIFICATION" não recebe nada', async () => {
    const r = await rodar(lembrete, { prompt: '[SYSTEM NOTIFICATION] tarefa em segundo plano terminou' })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('')
  })

  it('prompt vazio, só espaços ou ausente não recebe nada', async () => {
    for (const entrada of [{ prompt: '' }, { prompt: '  \n ' }, {}]) {
      const r = await rodar(lembrete, entrada)
      expect(r.code).toBe(0)
      expect(r.stdout).toBe('')
    }
  })
})

// Fábrica paralela (#199): a raiz é a do worktree do alvo, não só $CLAUDE_PROJECT_DIR.
describe('gate-issue: worktrees', () => {
  const git = (cwd: string, ...args: string[]) =>
    executar('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd })
  let fora = ''
  let wtDentro = ''
  let wtFora = ''

  beforeEach(async () => {
    fora = mkdtempSync(join(tmpdir(), 'gittools-gateissue-fora-'))
    await git(projeto, 'commit', '-q', '--allow-empty', '-m', 'base')
    wtDentro = join(projeto, '.claude', 'worktrees', 'a')
    wtFora = join(fora, 'b')
    expect((await git(projeto, 'worktree', 'add', '-q', '-b', 'ccr-x', wtDentro)).status).toBe(0)
    expect((await git(projeto, 'worktree', 'add', '-q', '-b', 'ccr-y', wtFora)).status).toBe(0)
    mkdirSync(join(wtDentro, '.claude'), { recursive: true })
    mkdirSync(join(wtFora, '.claude'), { recursive: true })
    return () => rmSync(fora, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })

  it('worktree fora do diretório do projeto, mas do mesmo repositório, bloqueia sem issue', async () => {
    expect((await escrever(join(wtFora, 'src', 'a.ts'))).code).toBe(2)
  })

  it('o marcador do projeto não vale no worktree e o do worktree não vale no projeto', async () => {
    marcador('#5\n')
    expect((await escrever(join(wtFora, 'a.ts'))).code).toBe(2)
    expect((await escrever(join(wtDentro, 'a.ts'))).code).toBe(2)
    writeFileSync(join(wtFora, '.claude', 'issue.local'), '#5\n')
    expect((await escrever(join(wtFora, 'a.ts'))).code).toBe(0)
    expect((await escrever(join(wtDentro, 'a.ts'))).code).toBe(2)
  })

  it('marcadores dos worktrees são graváveis sem issue', async () => {
    expect((await escrever(join(wtFora, '.claude', 'issue.local'))).code).toBe(0)
    expect((await escrever(join(wtDentro, '.claude', 'triagem.local'))).code).toBe(0)
  })

  it('marcador de worktree fora do projeto, alcançado por link simbólico (/var -> /private/var no macOS), é gravável sem issue', async () => {
    const link = join(fora, '..', `${basename(fora)}-link`)
    symlinkSync(fora, link)
    try {
      expect((await escrever(join(link, 'b', '.claude', 'issue.local'))).code).toBe(0)
      expect((await escrever(join(link, 'b', '.claude', 'triagem.local'))).code).toBe(0)
      // O link não afrouxa nada: código no worktree continua pedindo issue.
      expect((await escrever(join(link, 'b', 'src', 'a.ts'))).code).toBe(2)
    } finally {
      rmSync(link, { force: true })
    }
  })

  it('branch <tipo>/<N>-<assunto> libera (issue aberta) e bloqueia (fechada); ccr-* sem marcador bloqueia', async () => {
    await git(wtFora, 'switch', '-q', '-c', 'fix/5-ajuste')
    expect((await escrever(join(wtFora, 'a.ts'))).code).toBe(0)
    await git(wtFora, 'switch', '-q', '-c', 'fix/6-fechada')
    expect((await escrever(join(wtFora, 'a.ts'))).code).toBe(2)
    await git(wtFora, 'switch', '-q', '-c', 'ccr-z')
    expect((await escrever(join(wtFora, 'a.ts'))).code).toBe(2)
    await git(wtFora, 'switch', '-q', '-c', 'fix/5')
    expect((await escrever(join(wtFora, 'a.ts'))).code).toBe(2)
  })

  it('HANDOFF com #N no worktree libera só aquele worktree', async () => {
    mkdirSync(join(wtDentro, 'docs'), { recursive: true })
    writeFileSync(join(wtDentro, 'docs', 'HANDOFF.md'), '| E1 | #5 |\n')
    expect((await escrever(join(wtDentro, 'a.ts'))).code).toBe(0)
    expect((await escrever(join(wtFora, 'a.ts'))).code).toBe(2)
  })

  it('gt-escritor usa o cwd do hook: bloqueia no worktree sem issue mesmo com o projeto liberado', async () => {
    marcador('#5\n')
    const entrada = { tool_name: 'Agent', cwd: wtFora, tool_input: { subagent_type: 'gt-escritor', prompt: 'x' } }
    expect((await rodar(gate, entrada)).code).toBe(2)
    expect((await rodar(gate, { ...entrada, cwd: projeto })).code).toBe(0)
  })

  it('diretório de outro repositório continua fora do escopo', async () => {
    const outro = mkdtempSync(join(tmpdir(), 'gittools-gateissue-outro-'))
    try {
      await executar('git', ['init', '-q', outro])
      expect((await escrever(join(outro, 'a.ts'))).code).toBe(0)
    } finally {
      rmSync(outro, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  })
})
