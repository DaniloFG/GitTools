import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Gate da main (issue #100): o hook .claude/hooks/gate-main.sh bloqueia (exit 2) merge, auto-merge e push na main.
// O `gh` de verdade nunca é chamado: um `gh` falso no início do PATH responde pela base conforme o número do PR.
// Issue #104: base homolog só aceita a branch de trabalho (nunca a develop), já na história da develop (compare
// behind/identical) e com o rótulo `validada-develop`; qualquer consulta que falhe bloqueia.

const script = fileURLToPath(new URL('../.claude/hooks/gate-main.sh', import.meta.url))

let dir = ''
let ghLog = ''

// Por número de PR (`gh api repos/o/r/pulls/N`), todos com origem de trabalho `fix/x`, exceto onde dito:
//   1 -> base develop; 3 -> base main; 9 (e qualquer outro) -> o gh falha;
//   2 -> homolog, ponta abc0002 (compare behind), com rótulo: passa;
//   10 -> homolog, ponta abc0010 (compare identical), com rótulo: passa;
//   4 -> homolog com origem `develop` (e rótulo, ponta já na develop): bloqueia pela origem;
//   5 -> homolog, compare ahead, com rótulo; 6 -> compare diverged, com rótulo;
//   7 -> homolog, compare behind, mas só com outro rótulo (bug);
//   8 -> homolog, com rótulo, mas a consulta de compare falha; 12 -> compare devolve status vazio;
//   11 -> homolog, a consulta de origem/ponta/rótulos falha (a da base responde).
// Por seletor (`pr view`): "ramo-verde" -> ponta abc0002 com rótulo; "ramo-sem-rotulo" -> ponta abc0007 sem rótulo;
// "ramo-develop" -> origem develop; "ramo-nao-mergeado" -> ponta abc0005 (ahead) com rótulo.
// O gh falso devolve JSON e aplica o --jq com o jq de verdade, para o filtro do hook também ser testado.
// Cada chamada fica no log.
const ghFalso = `#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
a1=$1; a2=$2; a3=$3; todos="$*"; filtro=""
while [ $# -gt 0 ]; do
  if [ "$1" = --jq ]; then filtro=$2; fi
  shift
done
saida() { if [ -n "$filtro" ]; then printf '%s' "$1" | jq -r "$filtro"; else printf '%s\\n' "$1"; fi; }
ok='{"name":"validada-develop"}'
pr() { saida '{"base":{"ref":"'"$1"'"},"head":{"ref":"'"$2"'","sha":"'"$3"'"},"labels":['"$4"']}'; exit 0; }
cmp() { saida '{"status":"'"$1"'"}'; exit 0; }
vista() { saida '{"headRefName":"'"$1"'","headRefOid":"'"$2"'","labels":['"$3"']}'; exit 0; }
if [ "$a1" = api ]; then
  case "$a2" in
    */pulls/1) pr develop fix/x abc0001 "$ok" ;;
    */pulls/2) pr homolog fix/x abc0002 "$ok" ;;
    */pulls/3) pr main fix/x abc0003 "$ok" ;;
    */pulls/4) pr homolog develop abc0004 "$ok" ;;
    */pulls/5) pr homolog fix/x abc0005 "$ok" ;;
    */pulls/6) pr homolog fix/x abc0006 "$ok" ;;
    */pulls/7) pr homolog fix/x abc0007 '{"name":"bug"}' ;;
    */pulls/8) pr homolog fix/x abc0008 "$ok" ;;
    */pulls/10) pr homolog fix/x abc0010 "$ok" ;;
    */pulls/11) case "$filtro" in *head.ref*) exit 1 ;; *) pr homolog fix/x abc0011 "$ok" ;; esac ;;
    */pulls/12) pr homolog fix/x abc0012 "$ok" ;;
    */compare/develop...abc0002) cmp behind ;;
    */compare/develop...abc0004) cmp behind ;;
    */compare/develop...abc0005) cmp ahead ;;
    */compare/develop...abc0006) cmp diverged ;;
    */compare/develop...abc0007) cmp behind ;;
    */compare/develop...abc0010) cmp identical ;;
    */compare/develop...abc0012) cmp '' ;;
  esac
fi
if [ "$a1" = pr ] && [ "$a2" = view ]; then
  case "$a3" in
    ramo-verde) case "$todos" in *headRefOid*) vista ramo-verde abc0002 "$ok" ;; *baseRefName*) echo homolog; exit 0 ;; esac ;;
    ramo-sem-rotulo) case "$todos" in *headRefOid*) vista ramo-sem-rotulo abc0007 '' ;; *baseRefName*) echo homolog; exit 0 ;; esac ;;
    ramo-develop) case "$todos" in *headRefOid*) vista develop abc0004 "$ok" ;; *baseRefName*) echo homolog; exit 0 ;; esac ;;
    ramo-nao-mergeado) case "$todos" in *headRefOid*) vista ramo-nao-mergeado abc0005 "$ok" ;; *baseRefName*) echo homolog; exit 0 ;; esac ;;
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

describe('gate-main: a homolog recebe só a branch de trabalho, mergeada e validada na develop', () => {
  const msgNunca = 'a homolog recebe a branch de trabalho, nunca a develop'
  const msgValidada = 'a branch precisa estar mergeada e validada na develop'

  it.each([2, 10])('PR %i (ancestral da develop e com rótulo) passa por MCP, gh pr merge e gh api', (n) => {
    expect(mcp('merge_pull_request', pr(n)).code).toBe(0)
    expect(bash(`gh pr merge ${n}`).code).toBe(0)
    expect(bash(`gh api -X PUT repos/o/r/pulls/${n}/merge`).code).toBe(0)
  })

  it('origem develop bloqueia em todos os caminhos, sem nem consultar o compare', () => {
    const r = mcp('merge_pull_request', pr(4))
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DE PROMOÇÃO')
    expect(r.stderr).toContain(msgNunca)
    expect(bash('gh pr merge 4').code).toBe(2)
    expect(bash('gh api -X PUT repos/o/r/pulls/4/merge').code).toBe(2)
    expect(mcp('enable_pr_auto_merge', pr(4)).code).toBe(2)
    expect(readFileSync(ghLog, 'utf8')).not.toContain('compare')
  })

  it.each([
    ['ahead (a branch não foi mergeada na develop)', 5],
    ['diverged', 6],
  ])('ponta fora da história da develop (%s) bloqueia com a mensagem da promoção', (_nome, n) => {
    const r = mcp('merge_pull_request', pr(n))
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DE PROMOÇÃO')
    expect(r.stderr).toContain(msgValidada)
    expect(bash(`gh pr merge ${n}`).code).toBe(2)
    expect(bash(`gh api -X PUT repos/o/r/pulls/${n}/merge`).code).toBe(2)
  })

  it('sem o rótulo validada-develop bloqueia, mesmo com outro rótulo e a ponta na develop', () => {
    const r = mcp('merge_pull_request', pr(7))
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DE PROMOÇÃO')
    expect(r.stderr).toContain('validada-develop')
    expect(bash('gh pr merge 7').code).toBe(2)
    expect(bash('gh api -X PUT repos/o/r/pulls/7/merge').code).toBe(2)
  })

  it.each([
    ['a consulta de compare falha', 8],
    ['o compare devolve status vazio', 12],
    ['a consulta de origem, ponta e rótulos falha', 11],
  ])('falha fechada: quando %s, bloqueia', (_nome, n) => {
    const r = mcp('merge_pull_request', pr(n))
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DE PROMOÇÃO')
    expect(bash(`gh pr merge ${n}`).code).toBe(2)
    expect(bash(`gh api -X PUT repos/o/r/pulls/${n}/merge`).code).toBe(2)
  })

  it('auto-merge na homolog também exige as três condições', () => {
    expect(mcp('enable_pr_auto_merge', pr(2)).code).toBe(0)
    for (const n of [4, 5, 7, 8]) expect(mcp('enable_pr_auto_merge', pr(n)).code).toBe(2)
  })

  it('base develop passa sem nenhuma consulta de promoção (compare, rótulos)', () => {
    expect(mcp('merge_pull_request', pr(1)).code).toBe(0)
    expect(bash('gh pr merge 1').code).toBe(0)
    const log = readFileSync(ghLog, 'utf8')
    expect(log).not.toContain('compare')
    expect(log).not.toContain('head.ref')
  })

  it('base main continua bloqueada pela regra da main, sem consultar a promoção', () => {
    const r = mcp('merge_pull_request', pr(3))
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DA MAIN')
    expect(readFileSync(ghLog, 'utf8')).not.toContain('compare')
  })

  it('merge por seletor de ramo (sem número) confere origem, ponta e rótulo', () => {
    expect(bash('gh pr merge ramo-verde').code).toBe(0)
    const semRotulo = bash('gh pr merge ramo-sem-rotulo')
    expect(semRotulo.code).toBe(2)
    expect(semRotulo.stderr).toContain('validada-develop')
    expect(bash('gh pr merge ramo-nao-mergeado').code).toBe(2)
    const deDevelop = bash('gh pr merge ramo-develop')
    expect(deDevelop.code).toBe(2)
    expect(deDevelop.stderr).toContain(msgNunca)
  })

  it('por seletor com -R fora do formato dono/repo não dá para confirmar e bloqueia', () => {
    expect(bash('gh pr merge ramo-verde -R github.com/o/r').code).toBe(2)
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
