import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
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
beforeEach(() => {
  rmSync(ghLog, { force: true })
  projeto = mkdtempSync(join(tmpdir(), 'gittools-gateissue-proj-'))
  mkdirSync(join(projeto, '.claude'))
  mkdirSync(join(projeto, 'docs'))
  spawnSync('git', ['init', '-q', projeto])
  spawnSync('git', ['-C', projeto, 'remote', 'add', 'origin', 'https://github.com/dono/repo.git'])
  return () => rmSync(projeto, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

const marcador = (conteudo: string) => writeFileSync(join(projeto, '.claude', 'issue.local'), conteudo)
const handoff = (conteudo: string) => writeFileSync(join(projeto, 'docs', 'HANDOFF.md'), conteudo)

function rodar(script: string, entrada: unknown) {
  const r = spawnSync('bash', [script], {
    input: JSON.stringify(entrada),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, GH_LOG: ghLog, CLAUDE_PROJECT_DIR: projeto },
  })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

const escrever = (file_path: string, tool_name = 'Write') => rodar(gate, { tool_name, tool_input: { file_path, content: 'x' } })
const escreverNoProjeto = () => escrever(join(projeto, 'src', 'a.ts'))
const agente = (subagent_type: string) => rodar(gate, { tool_name: 'Agent', tool_input: { subagent_type, prompt: 'faça' } })

describe('gate-issue: sem issue ativa', () => {
  it('sem marcador e sem HANDOFF, Write no projeto bloqueia com a mensagem do gate', () => {
    const r = escreverNoProjeto()
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DE ISSUE')
    expect(r.stderr).toContain('.claude/issue.local')
    expect(r.stderr).toContain('mcp__github__issue_write')
  })

  it('Edit e NotebookEdit também bloqueiam (este com notebook_path)', () => {
    expect(escrever(join(projeto, 'src', 'a.ts'), 'Edit').code).toBe(2)
    const r = rodar(gate, { tool_name: 'NotebookEdit', tool_input: { notebook_path: join(projeto, 'n.ipynb') } })
    expect(r.code).toBe(2)
  })

  it('caminho relativo e ".." que voltam ao projeto continuam bloqueados', () => {
    expect(escrever('src/a.ts').code).toBe(2)
    // Concatenação de propósito: join() já normalizaria o ".." e o hook não veria o caminho torto.
    expect(escrever(`/tmp/../${projeto.slice(1)}/src/a.ts`).code).toBe(2)
  })

  it('HANDOFF sem #N e sem marcador bloqueia', () => {
    handoff('# Plano\n\n| Etapa | Issue |\n| --- | --- |\n| 1 | a criar |\n')
    expect(escreverNoProjeto().code).toBe(2)
  })

  it('marcador sem #N na primeira linha bloqueia, mesmo com #N nas outras linhas', () => {
    marcador('sem número\n#5\n')
    expect(escreverNoProjeto().code).toBe(2)
    expect(existsSync(ghLog)).toBe(false)
  })

  it('gt-escritor sem issue bloqueia; gt-leitor passa', () => {
    expect(agente('gt-escritor').code).toBe(2)
    expect(agente('gt-leitor').code).toBe(0)
  })
})

describe('gate-issue: issue ativa', () => {
  it('HANDOFF com #7 e sem marcador passa, sem chamar o gh', () => {
    handoff('| Etapa | Issue |\n| --- | --- |\n| 1 | #7 |\n')
    expect(escreverNoProjeto().code).toBe(0)
    expect(agente('gt-escritor').code).toBe(0)
    expect(existsSync(ghLog)).toBe(false)
  })

  it('marcador #5 com a issue aberta passa', () => {
    marcador('#5 ajuste do botão\n')
    expect(escreverNoProjeto().code).toBe(0)
    expect(agente('gt-escritor').code).toBe(0)
  })

  it('a consulta usa dono/repo do origin e o número do marcador', () => {
    marcador('#5\n')
    escreverNoProjeto()
    expect(readFileSync(ghLog, 'utf8')).toContain('api repos/dono/repo/issues/5 --jq .state')
  })

  it('marcador #6 com a issue fechada bloqueia, dizendo que está inexistente ou fechada', () => {
    marcador('#6\n')
    const r = escreverNoProjeto()
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('inexistente ou fechada')
    expect(agente('gt-escritor').code).toBe(2)
  })

  it('marcador #8 com 404 bloqueia', () => {
    marcador('#8\n')
    const r = escreverNoProjeto()
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('inexistente ou fechada')
  })

  it('falha de rede do gh (exit 1 sem 404) não bloqueia: só avisa no stderr', () => {
    marcador('#9\n')
    const r = escreverNoProjeto()
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('não foi possível confirmar a issue')
  })

  it('vários números: basta um aberto para passar; todos mortos bloqueia', () => {
    marcador('#6 #5\n')
    expect(escreverNoProjeto().code).toBe(0)
    marcador('#6 #8\n')
    expect(escreverNoProjeto().code).toBe(2)
  })

  it('sem origin derivável, a verificação no GitHub é pulada e o marcador vale', () => {
    spawnSync('git', ['-C', projeto, 'remote', 'remove', 'origin'])
    marcador('#6\n')
    expect(escreverNoProjeto().code).toBe(0)
    expect(existsSync(ghLog)).toBe(false)
  })

  it('o marcador vale mais que o HANDOFF: marcador fechado bloqueia mesmo com HANDOFF com #N', () => {
    handoff('| 1 | #7 |\n')
    marcador('#6\n')
    expect(escreverNoProjeto().code).toBe(2)
  })
})

describe('gate-issue: o que passa sem issue', () => {
  it('Write fora do projeto (/tmp) passa', () => {
    expect(escrever('/tmp/x').code).toBe(0)
  })

  it('Write nos marcadores .claude/issue.local e .claude/triagem.local passa (senão não há como registrar a issue)', () => {
    expect(escrever(join(projeto, '.claude', 'issue.local')).code).toBe(0)
    expect(escrever(join(projeto, '.claude', 'triagem.local')).code).toBe(0)
  })

  it('outro arquivo de .claude/ continua bloqueado', () => {
    expect(escrever(join(projeto, '.claude', 'settings.json')).code).toBe(2)
  })

  it('outras ferramentas passam sem abrir o jq nem o gh', () => {
    expect(rodar(gate, { tool_name: 'Read', tool_input: { file_path: join(projeto, 'a.ts') } }).code).toBe(0)
    expect(rodar(gate, { tool_name: 'Bash', tool_input: { command: 'ls' } }).code).toBe(0)
    expect(existsSync(ghLog)).toBe(false)
  })
})

describe('lembrete-issue', () => {
  it('imprime JSON válido de UserPromptSubmit com o lembrete obrigatório', () => {
    const r = rodar(lembrete, { prompt: 'ajusta o botão de commit' })
    expect(r.code).toBe(0)
    const saida = JSON.parse(r.stdout)
    expect(saida.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit')
    expect(saida.hookSpecificOutput.additionalContext).toContain('OBRIGATÓRIO')
    expect(saida.hookSpecificOutput.additionalContext).toContain('.claude/issue.local')
    expect(saida.hookSpecificOutput.additionalContext).toContain('.claude/rules/github.md')
  })

  it('prompt que começa com "[SYSTEM NOTIFICATION" não recebe nada', () => {
    const r = rodar(lembrete, { prompt: '[SYSTEM NOTIFICATION] tarefa em segundo plano terminou' })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('')
  })

  it('prompt vazio, só espaços ou ausente não recebe nada', () => {
    for (const entrada of [{ prompt: '' }, { prompt: '  \n ' }, {}]) {
      const r = rodar(lembrete, entrada)
      expect(r.code).toBe(0)
      expect(r.stdout).toBe('')
    }
  })
})
