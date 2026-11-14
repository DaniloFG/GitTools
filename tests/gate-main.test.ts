import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Gate da main (issue #100): o hook .claude/hooks/gate-main.sh bloqueia (exit 2) merge, auto-merge e push na main.
// O `gh` de verdade nunca é chamado: um `gh` falso no início do PATH responde pela base conforme o número do PR.
// Issue #104: base homolog só aceita a branch de trabalho (nunca a develop), já na história da develop (compare
// behind/identical) e com o rótulo `validada-develop`; qualquer consulta que falhe bloqueia.
// Issue #110: merge com base develop ou homolog exige o check-run `QA` da ponta com conclusão `success`.
// Issue #121: com vários check-runs `QA` no mesmo sha, decide o de maior `id` (o mais recente), não a ordem da lista.
// Issue #224: via estreita da main. O merge homolog -> main passa só com origem homolog, os dois rótulos de validação,
// mergeable_state clean, QA e todos os check-runs verdes, método merge commit explícito; auto-merge e --delete-branch não.

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
//   20 -> develop, QA failure; 21 -> develop, check QA ausente; 23 -> develop, a consulta do check QA falha;
//   22 -> homolog, compare behind, com rótulo, QA failure; 24 -> develop, QA in_progress (conclusion null).
//   25..29 -> develop, com dois check-runs QA no mesmo sha (issue #121; ids e ordem na lista em cada caso):
//   25 abc0025 cancelled (id 1) antes de success (id 2): passa; 26 abc0026 success (id 2) antes de failure (id 3): bloqueia;
//   27 abc0027 failure (id 3) antes de success (id 2): bloqueia; 28 abc0028 success (id 2) e QA em andamento (id 3): bloqueia;
//   29 abc0029 success (id 5) antes de cancelled (id 1): passa.
//   Base main (issue #224), todos com rótulos validada-develop e validada-homolog e estado clean, salvo onde dito:
//   30 -> origem homolog, ponta abc0030, QA e lint success (total_count 2): passa; 31 -> origem develop; 32 -> origem fix/x;
//   33 -> sem validada-develop; 34 -> sem validada-homolog; 35 -> mergeable_state dirty; 36 -> QA failure;
//   37 -> QA success e lint failure; 38 -> lint pendente (in_progress, conclusion null); 39 -> lint cancelled;
//   40 -> total_count 3 com 2 itens (paginação); 41 -> a consulta de origem/rótulos/estado falha;
//   42 -> a consulta de todos os check-runs (per_page) falha, a do QA responde.
//   Todos os PRs de base main têm ponta abc00NN (NN = o número) e, quando chegam aos check-runs, o job obrigatório
//   `Validação (homolog)` (issue #224, rodada 4): 30 tem QA, lint e Validação success (total_count 3).
//   45 -> sem o check-run Validação (homolog) na ponta; 47 -> Validação skipped; 48 -> Validação em andamento;
//   49 -> Validação neutral; 50 -> Validação id 3 cancelled e id 9 success (decide o maior id: passa);
//   51 -> Validação id 9 failure e id 3 success (decide o maior id: bloqueia); 52 -> QA skipped;
//   53 -> lint skipped e docs neutral (os não obrigatórios aceitam), QA e Validação success: passa.
// Por seletor (`pr view`): "ramo-verde" -> ponta abc0002 com rótulo; "ramo-sem-rotulo" -> ponta abc0007 sem rótulo;
// "ramo-develop" -> origem develop; "ramo-nao-mergeado" -> ponta abc0005 (ahead) com rótulo;
// "ramo-qa-vermelho" -> base develop, ponta abc0020 (QA failure); "ramo-develop-verde" -> base develop, ponta abc0001;
// "ramo-main-verde" -> base main, origem homolog, ponta abc0030, CLEAN; "ramo-main-fix" -> base main, origem fix/x;
// "ramo-main-fork" -> base main, origem homolog, mas PR de fork (isCrossRepository true).
// PRs 43 e 44 (base main, origem homolog, tudo verde): 43 -> head.repo de fork (fork/r); 44 -> head.repo null.
// Check-runs (`*/commits/SHA/check-runs`): QA success para qualquer SHA, exceto os dedicados acima (abc0020 e
// abc0022 failure; abc0021 lista vazia; abc0023 o gh falha; abc0024 conclusion null; abc0025..abc0029 dois QA, #121).
// O gh falso devolve JSON e aplica o --jq com o jq de verdade, para o filtro do hook também ser testado.
// Cada chamada fica no log.
const ghFalso = `#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
[ -n "$GH_ATRASO" ] && sleep "$GH_ATRASO"
a1=$1; a2=$2; a3=$3; todos="$*"; filtro=""
while [ $# -gt 0 ]; do
  if [ "$1" = --jq ]; then filtro=$2; fi
  shift
done
saida() { if [ -n "$filtro" ]; then printf '%s' "$1" | jq -r "$filtro"; else printf '%s\\n' "$1"; fi; }
ok='{"name":"validada-develop"}'
ok2='{"name":"validada-develop"},{"name":"validada-homolog"}'
verde='{"name":"QA","conclusion":"success"}'
qa_ok='{"name":"QA","id":7,"status":"completed","conclusion":"success"}'
lint_ok='{"name":"lint","id":8,"status":"completed","conclusion":"success"}'
val_ok='{"name":"Validação (homolog)","id":9,"status":"completed","conclusion":"success"}'
pr() {
  est=clean; [ -n "$5" ] && est=$5
  hrepo='{"full_name":"o/r"}'; [ "$6" = fork ] && hrepo='{"full_name":"fork/r"}'; [ "$6" = nulo ] && hrepo=null
  saida '{"base":{"ref":"'"$1"'","repo":{"full_name":"o/r"}},"head":{"ref":"'"$2"'","sha":"'"$3"'","repo":'"$hrepo"'},"labels":['"$4"'],"mergeable_state":"'"$est"'"}'; exit 0
}
cmp() { saida '{"status":"'"$1"'"}'; exit 0; }
vista() { cruz=false; [ -n "$4" ] && cruz=$4; saida '{"headRefName":"'"$1"'","headRefOid":"'"$2"'","labels":['"$3"'],"mergeStateStatus":"CLEAN","isCrossRepository":'"$cruz"'}'; exit 0; }
qa() { saida '{"check_runs":['"$1"']}'; exit 0; }
runs() { saida '{"total_count":'"$2"',"check_runs":['"$1"']}'; exit 0; }
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
    */pulls/20) pr develop fix/x abc0020 "$ok" ;;
    */pulls/21) pr develop fix/x abc0021 "$ok" ;;
    */pulls/22) pr homolog fix/x abc0022 "$ok" ;;
    */pulls/23) pr develop fix/x abc0023 "$ok" ;;
    */pulls/24) pr develop fix/x abc0024 "$ok" ;;
    */pulls/25) pr develop fix/x abc0025 "$ok" ;;
    */pulls/26) pr develop fix/x abc0026 "$ok" ;;
    */pulls/27) pr develop fix/x abc0027 "$ok" ;;
    */pulls/28) pr develop fix/x abc0028 "$ok" ;;
    */pulls/29) pr develop fix/x abc0029 "$ok" ;;
    */pulls/30) pr main homolog abc0030 "$ok2" ;;
    */pulls/31) pr main develop abc0031 "$ok2" ;;
    */pulls/32) pr main fix/x abc0032 "$ok2" ;;
    */pulls/33) pr main homolog abc0033 '{"name":"validada-homolog"}' ;;
    */pulls/34) pr main homolog abc0034 "$ok" ;;
    */pulls/35) pr main homolog abc0035 "$ok2" dirty ;;
    */pulls/36) pr main homolog abc0036 "$ok2" ;;
    */pulls/37) pr main homolog abc0037 "$ok2" ;;
    */pulls/38) pr main homolog abc0038 "$ok2" ;;
    */pulls/39) pr main homolog abc0039 "$ok2" ;;
    */pulls/40) pr main homolog abc0040 "$ok2" ;;
    */pulls/41) case "$filtro" in *head.ref*) exit 1 ;; *) pr main homolog abc0041 "$ok2" ;; esac ;;
    */pulls/42) pr main homolog abc0042 "$ok2" ;;
    */pulls/43) pr main homolog abc0043 "$ok2" clean fork ;;
    */pulls/44) pr main homolog abc0044 "$ok2" clean nulo ;;
    */pulls/4[5-9]|*/pulls/5[0-3]) n=$(basename "$a2"); pr main homolog "abc00$n" "$ok2" ;;
    */compare/develop...abc0002) cmp behind ;;
    */compare/develop...abc0004) cmp behind ;;
    */compare/develop...abc0005) cmp ahead ;;
    */compare/develop...abc0006) cmp diverged ;;
    */compare/develop...abc0007) cmp behind ;;
    */compare/develop...abc0010) cmp identical ;;
    */compare/develop...abc0012) cmp '' ;;
    */compare/develop...abc0022) cmp behind ;;
    */commits/abc0020/check-runs*) qa '{"name":"QA","conclusion":"failure"}' ;;
    */commits/abc0021/check-runs*) qa '' ;;
    */commits/abc0022/check-runs*) qa '{"name":"QA","conclusion":"failure"}' ;;
    */commits/abc0023/check-runs*) exit 1 ;;
    */commits/abc0024/check-runs*) qa '{"name":"QA","status":"in_progress","conclusion":null}' ;;
    */commits/abc0025/check-runs*) qa '{"name":"QA","id":1,"conclusion":"cancelled"},{"name":"QA","id":2,"conclusion":"success"}' ;;
    */commits/abc0026/check-runs*) qa '{"name":"QA","id":2,"conclusion":"success"},{"name":"QA","id":3,"conclusion":"failure"}' ;;
    */commits/abc0027/check-runs*) qa '{"name":"QA","id":3,"conclusion":"failure"},{"name":"QA","id":2,"conclusion":"success"}' ;;
    */commits/abc0028/check-runs*) qa '{"name":"QA","id":2,"conclusion":"success"},{"name":"QA","id":3,"status":"in_progress","conclusion":null}' ;;
    */commits/abc0029/check-runs*) qa '{"name":"QA","id":5,"conclusion":"success"},{"name":"QA","id":1,"conclusion":"cancelled"}' ;;
    */commits/abc0030/check-runs*) runs "$qa_ok,$lint_ok,$val_ok" 3 ;;
    */commits/abc0036/check-runs*) runs '{"name":"QA","id":7,"status":"completed","conclusion":"failure"},'"$lint_ok,$val_ok" 3 ;;
    */commits/abc0037/check-runs*) runs "$qa_ok"',{"name":"lint","id":8,"status":"completed","conclusion":"failure"},'"$val_ok" 3 ;;
    */commits/abc0038/check-runs*) runs "$qa_ok"',{"name":"lint","id":8,"status":"in_progress","conclusion":null},'"$val_ok" 3 ;;
    */commits/abc0039/check-runs*) runs "$qa_ok"',{"name":"lint","id":8,"status":"completed","conclusion":"cancelled"},'"$val_ok" 3 ;;
    */commits/abc0040/check-runs*) runs "$qa_ok,$lint_ok,$val_ok" 4 ;;
    */commits/abc0045/check-runs*) runs "$qa_ok,$lint_ok" 2 ;;
    */commits/abc0047/check-runs*) runs "$qa_ok,$lint_ok"',{"name":"Validação (homolog)","id":9,"status":"completed","conclusion":"skipped"}' 3 ;;
    */commits/abc0048/check-runs*) runs "$qa_ok,$lint_ok"',{"name":"Validação (homolog)","id":9,"status":"in_progress","conclusion":null}' 3 ;;
    */commits/abc0049/check-runs*) runs "$qa_ok,$lint_ok"',{"name":"Validação (homolog)","id":9,"status":"completed","conclusion":"neutral"}' 3 ;;
    */commits/abc0050/check-runs*) runs "$qa_ok,$lint_ok"',{"name":"Validação (homolog)","id":3,"status":"completed","conclusion":"cancelled"},'"$val_ok" 4 ;;
    */commits/abc0051/check-runs*) runs "$qa_ok,$lint_ok"',{"name":"Validação (homolog)","id":9,"status":"completed","conclusion":"failure"},{"name":"Validação (homolog)","id":3,"status":"completed","conclusion":"success"}' 4 ;;
    */commits/abc0052/check-runs*) runs '{"name":"QA","id":7,"status":"completed","conclusion":"skipped"},'"$lint_ok,$val_ok" 3 ;;
    */commits/abc0053/check-runs*) runs "$qa_ok"',{"name":"lint","id":8,"status":"completed","conclusion":"skipped"},{"name":"docs","id":10,"status":"completed","conclusion":"neutral"},'"$val_ok" 4 ;;
    */commits/abc0042/check-runs*) case "$a2" in *per_page*) exit 1 ;; *) qa "$qa_ok" ;; esac ;;
    */commits/*/check-runs*) qa "$verde" ;;
  esac
fi
if [ "$a1" = pr ] && [ "$a2" = view ]; then
  case "$a3" in
    ramo-verde) case "$todos" in *headRefOid*) vista ramo-verde abc0002 "$ok" ;; *baseRefName*) echo homolog; exit 0 ;; esac ;;
    ramo-sem-rotulo) case "$todos" in *headRefOid*) vista ramo-sem-rotulo abc0007 '' ;; *baseRefName*) echo homolog; exit 0 ;; esac ;;
    ramo-develop) case "$todos" in *headRefOid*) vista develop abc0004 "$ok" ;; *baseRefName*) echo homolog; exit 0 ;; esac ;;
    ramo-nao-mergeado) case "$todos" in *headRefOid*) vista ramo-nao-mergeado abc0005 "$ok" ;; *baseRefName*) echo homolog; exit 0 ;; esac ;;
    ramo-qa-vermelho) case "$todos" in *headRefOid*) vista ramo-qa-vermelho abc0020 "$ok" ;; *baseRefName*) echo develop; exit 0 ;; esac ;;
    ramo-develop-verde) case "$todos" in *headRefOid*) vista ramo-develop-verde abc0001 "$ok" ;; *baseRefName*) echo develop; exit 0 ;; esac ;;
    ramo-main-verde) case "$todos" in *headRefOid*) vista homolog abc0030 "$ok2" ;; *baseRefName*) echo main; exit 0 ;; esac ;;
    ramo-main-fix) case "$todos" in *headRefOid*) vista fix/x abc0030 "$ok2" ;; *baseRefName*) echo main; exit 0 ;; esac ;;
    ramo-main-fork) case "$todos" in *headRefOid*) vista homolog abc0030 "$ok2" true ;; *baseRefName*) echo main; exit 0 ;; esac ;;
  esac
fi
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

// `cwd` é o diretório em que o hook roda (o `git symbolic-ref` do push sem destino explícito usa o diretório atual).
// `extraEnv` é para o prazo global do hook: GATE_MAIN_PRAZO (só dos testes) e GH_ATRASO (o gh falso dorme esse tanto).
async function rodar(toolName: string, toolInput: Record<string, unknown>, cwd?: string, extraEnv: Record<string, string> = {}) {
  const r = await executar('bash', [script], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
    env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`, GH_LOG: ghLog, ...extraEnv },
    cwd,
  })
  return { code: r.status, stderr: r.stderr }
}

const bash = (command: string, cwd?: string, extraEnv?: Record<string, string>) => rodar('Bash', { command }, cwd, extraEnv)
const mcp = (nome: string, entrada: Record<string, unknown>) => rodar(`mcp__github__${nome}`, entrada)
const pr = (numero: number) => ({ owner: 'o', repo: 'r', pullNumber: numero })
// Merge na main só pelo gh, com a ponta conferida (todo PR de base main do gh falso tem ponta abc00NN).
const viaGh = (n: number) => bash(`gh pr merge ${n} --merge -R o/r --match-head-commit abc00${n}`)

describe('gate-main: GitHub MCP', () => {
  it.each([1, 2])('merge do PR %i (base develop/homolog) passa', async (n) => {
    expect((await mcp('merge_pull_request', pr(n))).code).toBe(0)
  })

  it('merge do PR 3 (base main, origem fix/x) pelo gh bloqueia pela origem, com mensagem em português', async () => {
    const r = await viaGh(3)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DA MAIN')
    expect(r.stderr).toContain('a main só recebe a homolog (origem do PR: fix/x)')
    expect(r.stderr).toContain('Via estreita da main')
  })

  it('merge de PR com base main pelo MCP bloqueia sempre, mesmo elegível, e aponta o caminho do gh', async () => {
    for (const entrada of [pr(3), pr(30), { ...pr(30), merge_method: 'merge', expectedHeadSha: 'abc0030' }]) {
      const r = await mcp('merge_pull_request', entrada)
      expect(r.code).toBe(2)
      expect(r.stderr).toContain('GATE DA MAIN: bloqueado.')
      expect(r.stderr).toContain('não passa pelo GitHub MCP')
      expect(r.stderr).toContain('gh pr merge <N> --merge --match-head-commit <sha>')
      expect(r.stderr).toContain('gh api -X PUT repos/o/r/pulls/N/merge -f sha=<sha> -f merge_method=merge')
    }
    // O PR 30 só passa pelo gh, com a ponta (o mesmo PR, mesmo gate).
    expect((await viaGh(30)).code).toBe(0)
  })

  it('o MCP segue liberado em develop e homolog, inclusive com squash e auto-merge', async () => {
    expect((await mcp('merge_pull_request', { ...pr(1), merge_method: 'squash' })).code).toBe(0)
    expect((await mcp('merge_pull_request', pr(2))).code).toBe(0)
    expect((await mcp('enable_pr_auto_merge', pr(2))).code).toBe(0)
  })

  it('auto-merge do PR com base main bloqueia; com base develop passa', async () => {
    expect((await mcp('enable_pr_auto_merge', pr(3))).code).toBe(2)
    expect((await mcp('enable_pr_auto_merge', pr(1))).code).toBe(0)
  })

  it('falha fechada: gh que falha (PR 9) bloqueia e diz que não confirmou a base', async () => {
    const r = await mcp('merge_pull_request', pr(9))
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('não foi possível confirmar a base')
  })

  it('falha fechada: número do PR ausente bloqueia sem chamar o gh', async () => {
    expect((await mcp('merge_pull_request', { owner: 'o', repo: 'r' })).code).toBe(2)
    expect(existsSync(ghLog)).toBe(false)
  })

  it.each(['push_files', 'create_or_update_file', 'delete_file'])('%s: branch main bloqueia, feature/x passa', async (nome) => {
    expect((await mcp(nome, { owner: 'o', repo: 'r', branch: 'main' })).code).toBe(2)
    expect((await mcp(nome, { owner: 'o', repo: 'r', branch: 'refs/heads/main' })).code).toBe(2)
    expect((await mcp(nome, { owner: 'o', repo: 'r', branch: 'feature/x' })).code).toBe(0)
    expect((await mcp(nome, { owner: 'o', repo: 'r', branch: 'feature/main-menu' })).code).toBe(0)
  })

  it('update_pull_request: trocar a base para main bloqueia; outra base ou só o título passa', async () => {
    expect((await mcp('update_pull_request', { ...pr(1), base: 'main' })).code).toBe(2)
    expect((await mcp('update_pull_request', { ...pr(1), base: 'homolog' })).code).toBe(0)
    expect((await mcp('update_pull_request', { ...pr(1), title: 'novo título' })).code).toBe(0)
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
  ])('bloqueia: %s', async (comando) => {
    expect((await bash(comando)).code).toBe(2)
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
  ])('passa: %s', async (comando) => {
    expect((await bash(comando)).code).toBe(0)
  })
})

describe('gate-main: não apaga develop, homolog nem main (issue #116)', () => {
  it.each([
    'git push origin --delete develop',
    'git push origin -d homolog',
    'git push --delete origin refs/heads/develop',
    'git push origin :develop',
    'git push origin :refs/heads/homolog',
    'git branch -D develop',
    'git branch -d homolog',
    'git branch -dr origin/develop',
    'git branch --delete main',
    'gh api -X DELETE repos/o/r/git/refs/heads/develop',
    'gh api --method DELETE repos/o/r/git/refs/heads%2Fhomolog',
    'gh api -XDELETE repos/o/r/git/refs/heads/main',
    'gh api graphql -f query=mutation{deleteRef(input:{refId:x}){clientMutationId}}',
    'git push +:develop',
    // Issue #124: o refspec sem `refs/` e o `update-ref -d` escapavam; o destino em variável não é verificável.
    'git push origin :heads/develop',
    'git push origin :heads/homolog',
    'git push origin :heads/main',
    'git push origin +:heads/develop',
    'git push origin --delete heads/develop',
    'git update-ref -d refs/heads/develop',
    'git update-ref --delete refs/heads/homolog',
    'git update-ref -d refs/heads/main',
    'git update-ref -d refs/remotes/origin/develop',
    'git -C x update-ref -d refs/heads/develop',
    'git push origin ":$VAR"',
    'git push origin :$BRANCH',
    // Issue #124 (revisão): aspas somem antes da análise, então `$B` chega como token; apagar com variável não se confere.
    'git push origin --delete $BRANCH',
    'git push origin -d "$B"',
    'git push --delete origin $B',
    'gh api -X DELETE repos/o/r/git/refs/heads/$B',
  ])('bloqueia: %s', async (comando) => {
    const r = await bash(comando)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DE BRANCHES')
  })

  it.each([
    'git push origin --delete feature/x',
    'git push origin :feature/x',
    'git branch -D feature/x',
    'git branch -a',
    'git branch develop-copia',
    // Local `heads/develop` não é a branch protegida; `branch -D` continua fora do alcance da regra nova (#124).
    'git branch -D heads/develop',
    'git push origin HEAD:develop',
    'git push origin develop',
    'gh api -X DELETE repos/o/r/git/refs/heads/feature/x',
    'gh api repos/o/r/git/refs/heads/develop',
    'git update-ref -d refs/heads/feature/x',
    'git update-ref refs/heads/develop HEAD',
    'git update-ref -d refs/heads/develop-copia',
    'git push origin :heads/feature/x',
    'git push origin $BRANCH',
    'git push origin HEAD:$BRANCH',
    'git push --dry-run origin $BRANCH',
  ])('passa: %s', async (comando) => {
    expect((await bash(comando)).code).toBe(0)
  })
})

describe('gate-main: gh no Bash', () => {
  it('gh pr merge: base main bloqueia; develop e homolog passam', async () => {
    expect((await bash('gh pr merge 3 --merge')).code).toBe(2)
    expect((await bash('gh pr merge 3 --auto --squash')).code).toBe(2)
    expect((await bash('gh pr merge 1')).code).toBe(0)
    expect((await bash('gh pr merge 2 --auto')).code).toBe(0)
  })

  it('gh pr merge pela URL do PR confere a base', async () => {
    expect((await bash('gh pr merge https://github.com/o/r/pull/3 --merge')).code).toBe(2)
    expect((await bash('gh pr merge https://github.com/o/r/pull/1')).code).toBe(0)
  })

  it('falha fechada: gh pr merge cujo gh falha (PR 9) ou sem número bloqueia', async () => {
    expect((await bash('gh pr merge 9')).code).toBe(2)
    expect((await bash('gh pr merge')).code).toBe(2)
    expect((await bash('gh pr merge minha-branch --auto')).code).toBe(2)
  })

  it('gh api PUT/POST em /pulls/N/merge e auto_merge confere a base', async () => {
    expect((await bash('gh api -X PUT repos/o/r/pulls/3/merge -f merge_method=merge')).code).toBe(2)
    expect((await bash('gh api --method POST repos/o/r/pulls/3/ccr/auto_merge')).code).toBe(2)
    expect((await bash('gh api -XPUT repos/o/r/pulls/1/merge')).code).toBe(0)
    expect((await bash('gh api -X PUT repos/o/r/pulls/9/merge')).code).toBe(2)
  })

  it('gh api que muda a base para main bloqueia', async () => {
    expect((await bash('gh api -X PATCH repos/o/r/pulls/1 -f base=main')).code).toBe(2)
    expect((await bash(`gh api -X PATCH repos/o/r/pulls/1 -f base=refs/heads/main`)).code).toBe(2)
    expect((await bash('gh api -X PATCH repos/o/r/pulls/1 -f base=homolog')).code).toBe(0)
  })

  it('gh só de leitura passa, sem chamar o gh falso', async () => {
    for (const comando of ['gh pr view 3', 'gh api repos/o/r/pulls/3', 'gh api -X GET repos/o/r/pulls -f base=main', 'gh pr list']) {
      expect((await bash(comando)).code).toBe(0)
    }
    expect(existsSync(ghLog)).toBe(false)
  })
})

describe('gate-main: a homolog recebe só a branch de trabalho, mergeada e validada na develop', () => {
  const msgNunca = 'a homolog recebe a branch de trabalho, nunca a develop'
  const msgValidada = 'a branch precisa estar mergeada e validada na develop'

  it.each([2, 10])('PR %i (ancestral da develop e com rótulo) passa por MCP, gh pr merge e gh api', async (n) => {
    expect((await mcp('merge_pull_request', pr(n))).code).toBe(0)
    expect((await bash(`gh pr merge ${n}`)).code).toBe(0)
    expect((await bash(`gh api -X PUT repos/o/r/pulls/${n}/merge`)).code).toBe(0)
  })

  it('origem develop bloqueia em todos os caminhos, sem nem consultar o compare', async () => {
    const r = await mcp('merge_pull_request', pr(4))
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DE PROMOÇÃO')
    expect(r.stderr).toContain(msgNunca)
    expect((await bash('gh pr merge 4')).code).toBe(2)
    expect((await bash('gh api -X PUT repos/o/r/pulls/4/merge')).code).toBe(2)
    expect((await mcp('enable_pr_auto_merge', pr(4))).code).toBe(2)
    expect(readFileSync(ghLog, 'utf8')).not.toContain('compare')
  })

  it.each([
    ['ahead (a branch não foi mergeada na develop)', 5],
    ['diverged', 6],
  ])('ponta fora da história da develop (%s) bloqueia com a mensagem da promoção', async (_nome, n) => {
    const r = await mcp('merge_pull_request', pr(n))
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DE PROMOÇÃO')
    expect(r.stderr).toContain(msgValidada)
    expect((await bash(`gh pr merge ${n}`)).code).toBe(2)
    expect((await bash(`gh api -X PUT repos/o/r/pulls/${n}/merge`)).code).toBe(2)
  })

  it('sem o rótulo validada-develop bloqueia, mesmo com outro rótulo e a ponta na develop', async () => {
    const r = await mcp('merge_pull_request', pr(7))
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DE PROMOÇÃO')
    expect(r.stderr).toContain('validada-develop')
    expect((await bash('gh pr merge 7')).code).toBe(2)
    expect((await bash('gh api -X PUT repos/o/r/pulls/7/merge')).code).toBe(2)
  })

  it.each([
    ['a consulta de compare falha', 8],
    ['o compare devolve status vazio', 12],
    ['a consulta de origem, ponta e rótulos falha', 11],
  ])('falha fechada: quando %s, bloqueia', async (_nome, n) => {
    const r = await mcp('merge_pull_request', pr(n))
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DE PROMOÇÃO')
    expect((await bash(`gh pr merge ${n}`)).code).toBe(2)
    expect((await bash(`gh api -X PUT repos/o/r/pulls/${n}/merge`)).code).toBe(2)
  })

  it('auto-merge na homolog também exige as três condições', async () => {
    expect((await mcp('enable_pr_auto_merge', pr(2))).code).toBe(0)
    for (const n of [4, 5, 7, 8]) expect((await mcp('enable_pr_auto_merge', pr(n))).code).toBe(2)
  })

  it('base develop passa sem nenhuma consulta de promoção (compare, rótulos)', async () => {
    expect((await mcp('merge_pull_request', pr(1))).code).toBe(0)
    expect((await bash('gh pr merge 1')).code).toBe(0)
    const log = readFileSync(ghLog, 'utf8')
    expect(log).not.toContain('compare')
    expect(log).not.toContain('head.ref')
  })

  it('base main continua bloqueada pela regra da main, sem consultar a promoção da homolog', async () => {
    const r = await viaGh(3)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DA MAIN')
    expect(readFileSync(ghLog, 'utf8')).not.toContain('compare')
  })

  it('merge por seletor de ramo (sem número) confere origem, ponta e rótulo', async () => {
    expect((await bash('gh pr merge ramo-verde')).code).toBe(0)
    const semRotulo = await bash('gh pr merge ramo-sem-rotulo')
    expect(semRotulo.code).toBe(2)
    expect(semRotulo.stderr).toContain('validada-develop')
    expect((await bash('gh pr merge ramo-nao-mergeado')).code).toBe(2)
    const deDevelop = await bash('gh pr merge ramo-develop')
    expect(deDevelop.code).toBe(2)
    expect(deDevelop.stderr).toContain(msgNunca)
  })

  it('por seletor com -R fora do formato dono/repo não dá para confirmar e bloqueia', async () => {
    expect((await bash('gh pr merge ramo-verde -R github.com/o/r')).code).toBe(2)
  })
})

describe('gate-main: o check QA precisa estar verde na ponta do PR', () => {
  const msgQa = 'GATE DE QA: bloqueado.'

  it.each([
    ['develop', 1, 'abc0001'],
    ['homolog', 2, 'abc0002'],
  ])('base %s com QA success passa por MCP, gh pr merge, gh api e auto-merge', async (_base, n, sha) => {
    expect((await mcp('merge_pull_request', pr(n))).code).toBe(0)
    expect((await bash(`gh pr merge ${n}`)).code).toBe(0)
    expect((await bash(`gh api -X PUT repos/o/r/pulls/${n}/merge`)).code).toBe(0)
    expect((await mcp('enable_pr_auto_merge', pr(n))).code).toBe(0)
    expect(readFileSync(ghLog, 'utf8')).toContain(`repos/o/r/commits/${sha}/check-runs?check_name=QA`)
  })

  it.each([
    ['cancelado (id 1) antes de success (id 2): o mais novo passa', 25, 'abc0025'],
    ['success (id 5) antes de cancelado (id 1): a ordem da lista não decide', 29, 'abc0029'],
  ])('dois QA no mesmo sha, o mais novo success: passa pelos quatro caminhos (%s)', async (_nome, n, sha) => {
    expect((await mcp('merge_pull_request', pr(n))).code).toBe(0)
    expect((await bash(`gh pr merge ${n}`)).code).toBe(0)
    expect((await bash(`gh api -X PUT repos/o/r/pulls/${n}/merge`)).code).toBe(0)
    expect((await mcp('enable_pr_auto_merge', pr(n))).code).toBe(0)
    expect(readFileSync(ghLog, 'utf8')).toContain(`repos/o/r/commits/${sha}/check-runs?check_name=QA`)
  })

  it.each([
    ['QA em failure (develop)', 20],
    ['check QA ausente (develop)', 21],
    ['QA sem conclusão, em andamento (develop)', 24],
    ['a consulta do check QA falha (develop)', 23],
    ['QA em failure (homolog, promoção já passa)', 22],
    ['dois QA: success (id 2) listado antes do failure (id 3), o mais novo bloqueia', 26],
    ['dois QA: failure (id 3) listado antes do success (id 2), o mais novo bloqueia', 27],
    ['dois QA: success (id 2) e QA novo em andamento (id 3, conclusion null)', 28],
  ])('bloqueia com GATE DE QA em todos os caminhos: %s', async (_nome, n) => {
    const caminhos = [
      () => mcp('merge_pull_request', pr(n)),
      () => bash(`gh pr merge ${n}`),
      () => bash(`gh api -X PUT repos/o/r/pulls/${n}/merge`),
      () => mcp('enable_pr_auto_merge', pr(n)),
    ]
    for (const caminho of caminhos) {
      const r = await caminho()
      expect(r.code).toBe(2)
      expect(r.stderr).toContain(msgQa)
      expect(r.stderr).toContain('job `QA` do workflow')
    }
  })

  it.each([4, 7])('PR %i (homolog) bloqueia por promoção antes de consultar o QA', async (n) => {
    const r = await mcp('merge_pull_request', pr(n))
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DE PROMOÇÃO')
    expect(readFileSync(ghLog, 'utf8')).not.toContain('check-runs')
  })

  it('base main com origem errada continua bloqueada pela regra da main, sem consultar o check QA', async () => {
    const r = await viaGh(3)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DA MAIN')
    expect(readFileSync(ghLog, 'utf8')).not.toContain('check-runs')
  })

  it('por seletor de base develop, o QA da ponta (headRefOid) decide', async () => {
    const vermelho = await bash('gh pr merge ramo-qa-vermelho')
    expect(vermelho.code).toBe(2)
    expect(vermelho.stderr).toContain(msgQa)
    expect(readFileSync(ghLog, 'utf8')).toContain('repos/{owner}/{repo}/commits/abc0020/check-runs')
    expect((await bash('gh pr merge ramo-develop-verde')).code).toBe(0)
  })

  it('por seletor com -R dono/repo consulta o QA desse repositório; fora do formato bloqueia', async () => {
    expect((await bash('gh pr merge ramo-qa-vermelho -R o/r')).code).toBe(2)
    expect(readFileSync(ghLog, 'utf8')).toContain('repos/o/r/commits/abc0020/check-runs')
    const foraDoFormato = await bash('gh pr merge ramo-develop-verde -R github.com/o/r')
    expect(foraDoFormato.code).toBe(2)
    expect(foraDoFormato.stderr).toContain(msgQa)
  })
})

describe('gate-main: via estreita da main, só o merge da homolog (issue #224)', () => {
  // Todo PR de base main tem ponta abc00NN; o merge elegível traz a ponta conferida (issue #224, rodada 4).
  const msgMain = 'GATE DA MAIN: bloqueado.'
  const pm30 = '--match-head-commit abc0030'

  it('PR 30 (homolog, os dois rótulos, clean, checks verdes, merge commit, ponta conferida) passa por gh pr merge e gh api', async () => {
    expect((await bash(`gh pr merge 30 --merge ${pm30}`)).code).toBe(0)
    expect((await bash(`gh pr merge 30 -m --match-head-commit=abc0030`)).code).toBe(0)
    expect((await bash('gh api -X PUT repos/o/r/pulls/30/merge -f merge_method=merge -f sha=abc0030')).code).toBe(0)
    const log = readFileSync(ghLog, 'utf8')
    expect(log).toContain('repos/o/r/commits/abc0030/check-runs?check_name=QA')
    expect(log).toContain('repos/o/r/commits/abc0030/check-runs?filter=latest&per_page=100')
  })

  // O settings.json dá 120 s às duas entradas do gate-main. Hook morto por tempo deixa a ferramenta seguir (falha
  // aberta), então o pior caso do hook (chamadas gh da via da main x o timeout de cada uma) tem de caber com folga.
  // O limite de tempo vale para o hook inteiro, não por segmento: `a && b && c` somava as chamadas de cada segmento e
  // podia passar dos 120 s do settings.json (hook morto = falha aberta). Passado o prazo global, o segmento seguinte
  // falha fechado sem chamar o gh. Este teste usa o relógio de verdade (gh falso com sleep): o `SECONDS` do bash conta
  // segundos inteiros e pode andar até 1 s à frente do tempo real, então a conta tem folga nos dois lados: o primeiro
  // segmento (PR 1, base develop) faz 3 chamadas de 2 s; a terceira começa com o relógio em no máximo 5 s (< prazo 6) e,
  // ao fim, 6 s reais já passaram (>= prazo): o segundo segmento é recusado antes da primeira consulta.
  it('prazo global do hook: esgotado no primeiro segmento, o seguinte (merge elegível) bloqueia sem consultar o gh', async () => {
    const dois = `gh pr merge 1 --merge && gh pr merge 30 --merge ${pm30}`
    // Controle: sem atraso o mesmo comando passa inteiro, com o mesmo prazo curto.
    expect((await bash(dois, undefined, { GATE_MAIN_PRAZO: '6' })).code).toBe(0)
    expect(readFileSync(ghLog, 'utf8')).toContain('repos/{owner}/{repo}/pulls/30')
    rmSync(ghLog, { force: true })
    const lento = await bash(dois, undefined, { GATE_MAIN_PRAZO: '6', GH_ATRASO: '2' })
    expect(lento.code).toBe(2)
    expect(lento.stderr).toContain('Prazo do hook esgotado')
    expect(lento.stderr).toContain('GATE DA MAIN: bloqueado.')
    const log = readFileSync(ghLog, 'utf8')
    expect(log).toContain('repos/{owner}/{repo}/pulls/1 ')
    expect(log).not.toContain('pulls/30')
  })

  it('prazo global: sem a variável de teste ou com valor inválido o prazo é 90 s e o comando passa', async () => {
    const dois = `gh pr merge 1 --merge && gh pr merge 30 --merge ${pm30}`
    expect((await bash(dois)).code).toBe(0)
    expect((await bash(dois, undefined, { GATE_MAIN_PRAZO: 'abc' })).code).toBe(0)
  })

  // O prazo tem teto de 90 s: GATE_MAIN_PRAZO maior (que deixaria o hook passar dos 120 s do settings.json, falha
  // aberta) é cortado. O relógio é simulado por GATE_MAIN_SECONDS_FAKE, sem esperar.
  it.each([
    ['1000', '90'],
    ['91', '90'],
    ['9999', '90'],
    ['99999999999999999999', '90'],
    ['0', '90'],
    ['00', '90'],
    ['-5', '90'],
    ['', '90'],
    ['abc', '90'],
    ['1.5', '90'],
    ['090', '90'],
    ['08', '8'],
  ])('GATE_MAIN_PRAZO=%j vale %s s, com teto de 90', async (valor, efetivo) => {
    // Relógio em 95 s: o prazo efetivo (no máximo 90) já está esgotado e a primeira consulta é recusada.
    const r = await bash(`gh pr merge 30 --merge ${pm30}`, undefined, { GATE_MAIN_PRAZO: valor, GATE_MAIN_SECONDS_FAKE: '95' })
    expect(r.code).toBe(2)
    // O relógio é o simulado (95 s) mais o `SECONDS` real do hook, que pode já ter virado 1.
    expect(r.stderr).toMatch(new RegExp(`Prazo do hook esgotado \\((95|96) s de ${efetivo} s\\)`))
    expect(existsSync(ghLog)).toBe(false)
  })

  it('GATE_MAIN_PRAZO=1000 não prolonga o prazo: com o relógio em 80 s ainda passa, em 90 s bloqueia', async () => {
    const comando = `gh pr merge 30 --merge ${pm30}`
    expect((await bash(comando, undefined, { GATE_MAIN_PRAZO: '1000', GATE_MAIN_SECONDS_FAKE: '80' })).code).toBe(0)
    const r = await bash(comando, undefined, { GATE_MAIN_PRAZO: '1000', GATE_MAIN_SECONDS_FAKE: '90' })
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/Prazo do hook esgotado \((90|91) s de 90 s\)/)
  })

  it('GATE_MAIN_SECONDS_FAKE inválido é ignorado (zero): o comando passa', async () => {
    expect((await bash(`gh pr merge 30 --merge ${pm30}`, undefined, { GATE_MAIN_SECONDS_FAKE: 'abc' })).code).toBe(0)
  })

  it('o pior caso de tempo da via da main cabe no timeout das duas entradas do gate-main no settings.json', async () => {
    const unico = await bash(`gh pr merge 30 --merge ${pm30}`)
    expect(unico.code).toBe(0)
    // O --jq de cada chamada tem várias linhas no log: contam-se só as linhas que abrem uma chamada (`api ...`).
    const chamadas = (readFileSync(ghLog, 'utf8').match(/^api /gm) ?? []).length
    expect(chamadas).toBe(4) // base, origem/rótulos/estado, QA e todos os check-runs
    // Limites lidos do script: teto por chamada (`[ "$t" -gt 15 ]`), prazo global (`GATE_MAIN_PRAZO:-90`) e a folga
    // de 10 s depois do prazo (`PRAZO + 10 - SECONDS`) que a última chamada ainda pode usar.
    const fonte = readFileSync(script, 'utf8')
    const porChamada = Number(/\[ "\$t" -gt (\d+) \] && t=\1/.exec(fonte)?.[1])
    const prazo = Number(/GATE_MAIN_PRAZO:-(\d+)/.exec(fonte)?.[1])
    const folga = Number(/PRAZO \+ (\d+) - SECONDS/.exec(fonte)?.[1])
    expect(porChamada).toBeGreaterThan(0)
    expect(prazo).toBeGreaterThan(0)
    expect(folga).toBeGreaterThan(0)
    // Um PR usa 4 chamadas no máximo: cabem no prazo; e o pior caso do hook inteiro (prazo + folga) cabe no timeout.
    expect(chamadas * porChamada).toBeLessThanOrEqual(prazo)
    const settings = JSON.parse(readFileSync(fileURLToPath(new URL('../.claude/settings.json', import.meta.url)), 'utf8')) as {
      hooks: { PreToolUse: { matcher: string; hooks: { command: string; timeout?: number }[] }[] }
    }
    const entradas = settings.hooks.PreToolUse.flatMap((e) => e.hooks).filter((h) => h.command.includes('gate-main.sh'))
    expect(entradas).toHaveLength(2)
    for (const h of entradas) expect(h.timeout ?? 60).toBeGreaterThanOrEqual(prazo + folga + 10)
  })

  it('por seletor de ramo: homolog com CLEAN passa; origem fix/x bloqueia', async () => {
    expect((await bash(`gh pr merge ramo-main-verde --merge ${pm30}`)).code).toBe(0)
    expect(readFileSync(ghLog, 'utf8')).toContain('repos/{owner}/{repo}/commits/abc0030/check-runs?filter=latest&per_page=100')
    const r = await bash(`gh pr merge ramo-main-fix --merge ${pm30}`)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('a main só recebe a homolog (origem do PR: fix/x)')
    expect((await bash(`gh pr merge ramo-main-verde ${pm30}`)).code).toBe(2)
    expect((await bash(`gh pr merge ramo-main-verde --merge ${pm30} -R github.com/o/r`)).code).toBe(2)
  })

  it.each([
    ['origem develop', 31, 'origem do PR: develop'],
    ['origem fix/x', 32, 'origem do PR: fix/x'],
    ['falta validada-develop', 33, 'validada-develop'],
    ['falta validada-homolog', 34, 'validada-homolog'],
    ['mergeable_state dirty', 35, 'mergeable_state: dirty'],
  ])('bloqueia por %s, sem consultar checks', async (_nome, n, trecho) => {
    const r = await viaGh(n)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
    expect(r.stderr).toContain(trecho)
    expect(readFileSync(ghLog, 'utf8')).not.toContain('check-runs')
  })

  it.each([
    ['QA failure', 36, 'o check QA do commit'],
    ['outro check em failure', 37, 'check-run(s)'],
    ['check pendente', 38, 'check-run(s)'],
    ['check cancelado', 39, 'check-run(s)'],
    ['total_count maior que os itens retornados (paginação)', 40, 'não cabem numa página'],
    ['a consulta dos check-runs falha', 42, 'não foi possível consultar todos os check-runs'],
  ])('bloqueia com %s', async (_nome, n, trecho) => {
    const r = await viaGh(n)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DE QA')
    expect(r.stderr).toContain(trecho)
  })

  it('falha fechada: a consulta de origem, rótulos e estado falha (PR 41)', async () => {
    const r = await viaGh(41)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
    expect(r.stderr).toContain('não foi possível obter origem, ponta, rótulos e estado')
  })

  it.each([
    ['--squash', 'gh pr merge 30 --squash --match-head-commit abc0030'],
    ['--rebase', 'gh pr merge 30 --rebase --match-head-commit abc0030'],
    ['sem método', 'gh pr merge 30 --match-head-commit abc0030'],
  ])('gh pr merge %s bloqueia pelo método, sem consultar os checks', async (_nome, comando) => {
    const r = await bash(comando)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('merge commit')
    expect(readFileSync(ghLog, 'utf8')).not.toContain('check-runs')
  })

  it.each([
    'gh pr merge 30 --squash',
    'gh pr merge 30 -s',
    'gh pr merge 30 --rebase',
    'gh pr merge 30 -r',
    'gh pr merge 30',
    'gh pr merge 30 --merge --squash',
    'gh pr merge 30 --merge --auto',
    'gh pr merge 30 --auto',
    'gh pr merge 30 --merge --delete-branch',
    'gh pr merge 30 -m -d',
    'gh pr merge 30 -md',
    'gh pr merge https://github.com/o/r/pull/30 --squash',
  ])('bloqueia: %s', async (comando) => {
    const r = await bash(comando)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
  })

  it.each([
    'gh api -X PUT repos/o/r/pulls/30/merge',
    'gh api -X PUT repos/o/r/pulls/30/merge -f merge_method=squash',
    'gh api -X PUT repos/o/r/pulls/30/merge -f merge_method=rebase',
    'gh api -X PUT repos/o/r/pulls/30/merge -f merge_method=',
    'gh api -X PUT repos/o/r/pulls/30/merge -f merge_method=merge -f merge_method=squash',
    'gh api -X PUT repos/o/r/pulls/30/merge?merge_method=squash -f merge_method=merge',
    'gh api -X PUT repos/o/r/pulls/30/auto_merge -f merge_method=merge',
  ])('bloqueia: %s', async (comando) => {
    expect((await bash(comando)).code).toBe(2)
  })

  it.each([
    'gh api -X PUT repos/o/r/pulls/30/merge --input corpo.json',
    'gh api -X PUT repos/o/r/pulls/30/merge --input -',
    'gh api -X PUT repos/o/r/pulls/30/merge --input=corpo.json',
    'gh api -X PUT repos/o/r/pulls/30/merge -f merge_method=merge --input corpo.json',
    'gh api -X PUT repos/o/r/pulls/30/merge --input corpo.json -f merge_method=merge',
    'gh api -X PUT repos/o/r/pulls/30/merge -f merge_method=merge -Fmerge_method=squash',
    'gh api -X PUT repos/o/r/pulls/30/merge -f merge_method=merge -fmerge_method=rebase',
    'gh api -X PUT repos/o/r/pulls/30/merge -Fmerge_method=squash',
  ])('gh api: corpo em arquivo ou valor colado à opção curta bloqueia na main: %s', async (comando) => {
    const r = await bash(comando)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
  })

  it('gh api: valor colado à opção curta é lido como campo (merge passa; base=main bloqueia)', async () => {
    expect((await bash('gh api -X PUT repos/o/r/pulls/30/merge -fmerge_method=merge -fsha=abc0030')).code).toBe(0)
    expect((await bash('gh api -X PUT repos/o/r/pulls/30/merge -Fmerge_method=merge -Fsha=abc0030')).code).toBe(0)
    expect((await bash('gh api -X PATCH repos/o/r/pulls/1 -fbase=main')).code).toBe(2)
  })

  it.each([
    'gh pr merge 30 --merge --delete-branch=true',
    'gh pr merge 30 --merge --delete-branch=false',
    'gh pr merge 30 --merge --auto=true',
    'gh pr merge 30 --merge --auto=false',
    'gh pr merge 30 --merge=false',
    'gh pr merge 30 --squash=false --merge',
  ])('gh pr merge com valor em booleana bloqueia na main: %s', async (comando) => {
    const r = await bash(comando)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
  })

  it('gh pr merge -Rdono/repo: o valor colado é o repositório, não opções curtas (-Ro/r não vira -r de rebase)', async () => {
    expect((await bash(`gh pr merge 30 --merge -Ro/r ${pm30}`)).code).toBe(0)
    expect((await bash(`gh pr merge 30 -Ro/r --merge ${pm30}`)).code).toBe(0)
    expect(readFileSync(ghLog, 'utf8')).toContain('repos/o/r/pulls/30')
    expect((await bash(`gh pr merge 30 -Ro/r ${pm30}`)).code).toBe(2)
    expect((await bash(`gh pr merge ramo-main-verde --merge -Rgithub.com/o/r ${pm30}`)).code).toBe(2)
    expect((await bash(`gh pr merge ramo-main-verde --merge -Ro/r ${pm30}`)).code).toBe(0)
  })

  it.each([
    ['head.repo de fork com ref homolog', 43],
    ['head.repo null (fork apagado)', 44],
  ])('PR de outro repositório bloqueia, mesmo com ref homolog e tudo verde: %s', async (_nome, n) => {
    const cli = await viaGh(n)
    expect(cli.code).toBe(2)
    expect(cli.stderr).toContain(msgMain)
    expect(cli.stderr).toContain('fork')
    expect(readFileSync(ghLog, 'utf8')).not.toContain('check-runs')
    const api = await bash(`gh api -X PUT repos/o/r/pulls/${n}/merge -f merge_method=merge -f sha=abc00${n}`)
    expect(api.code).toBe(2)
    expect(api.stderr).toContain('fork')
  })

  it('por seletor, isCrossRepository true (fork) bloqueia', async () => {
    const r = await bash(`gh pr merge ramo-main-fork --merge ${pm30}`)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('fork')
  })

  it.each([
    'gh api -X=PUT repos/o/r/pulls/30/merge -f merge_method=squash',
    'gh api -X=PUT repos/o/r/pulls/3/merge -f merge_method=merge',
    'gh api -X PUT repos/o/r/pulls/30/merge -f merge_method=merge -f=merge_method=squash',
    'gh api -X PUT repos/o/r/pulls/30/merge -f merge_method=merge -F=merge_method=squash',
    'gh api -X PUT repos/o/r/pulls/30/merge -f=merge_method=squash',
    'gh api -X PUT repos/o/r/pulls/30/merge -F=merge_method=rebase',
  ])('gh api: `=` depois da opção curta é normalizado e bloqueia: %s', async (comando) => {
    const r = await bash(comando)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
  })

  it('gh api: `-X=PUT`, `-f=` e `-F=` com merge_method=merge passam; `-R=o/r` também é lido', async () => {
    expect((await bash('gh api -X=PUT repos/o/r/pulls/30/merge -f merge_method=merge -f sha=abc0030')).code).toBe(0)
    expect((await bash('gh api -X=put repos/o/r/pulls/30/merge -f=merge_method=merge -f=sha=abc0030')).code).toBe(0)
    expect((await bash('gh api -X PUT repos/o/r/pulls/30/merge -F=merge_method=merge -F=sha=abc0030')).code).toBe(0)
    expect((await bash(`gh pr merge 30 --merge -R=o/r ${pm30}`)).code).toBe(0)
    expect((await bash('gh api -X=PATCH repos/o/r/pulls/1 -f=base=main')).code).toBe(2)
  })

  it.each([
    'timeout 60 gh pr merge 30 --squash',
    'timeout 1.5s gh pr merge 30 --squash',
    'timeout -k 5 60 gh pr merge 30 --squash',
    'timeout --signal KILL 2m gh pr merge 30 --squash',
    'bash -ec "gh pr merge 30 --squash"',
    'bash -xc "gh pr merge 30 --squash"',
    'bash -ic "gh pr merge 30 --squash"',
    'bash -e -c "gh pr merge 30 --squash"',
    'sh -x -c "gh pr merge 30 --squash"',
    '{ gh pr merge 30 --squash; }',
    'timeout 60 bash -ec "gh api -X PUT repos/o/r/pulls/30/merge -f merge_method=squash"',
  ])('prefixos que envolvem o comando não escondem o merge: %s', async (comando) => {
    const r = await bash(comando)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
  })

  it('prefixos que envolvem o comando também deixam passar o merge elegível', async () => {
    expect((await bash(`timeout 60 gh pr merge 30 --merge ${pm30}`)).code).toBe(0)
    expect((await bash(`bash -ec "gh pr merge 30 --merge ${pm30}"`)).code).toBe(0)
    expect((await bash(`{ gh pr merge 30 --merge ${pm30}; }`)).code).toBe(0)
  })

  it.each([
    'gh api -X PUT repos/o/r/pulls/30/merge/ -f merge_method=squash',
    'gh api -X PUT repos/o/r/pulls/30/merge/?x=1 -f merge_method=squash',
    'gh api -X PUT repos/o/r/pulls/30/merge// -f merge_method=squash',
    'gh api -X PUT repos/o/r/pulls/3/merge/ -f merge_method=merge',
    'gh api -X PUT repos/o/r/pulls/9/merge/ -f merge_method=merge',
    'gh api -X PUT repos/o/r/pulls/30/auto_merge/ -f merge_method=merge',
    'gh api -X PUT repos/o/r/pulls/30/merge/',
  ])('endpoint com barra final ou query não escapa da checagem: %s', async (comando) => {
    expect((await bash(comando)).code).toBe(2)
  })

  it('endpoint de merge com barra final e merge_method=merge passa no PR 30; na develop também', async () => {
    expect((await bash('gh api -X PUT repos/o/r/pulls/30/merge/ -f merge_method=merge -f sha=abc0030')).code).toBe(0)
    expect((await bash('gh api -X PUT repos/o/r/pulls/1/merge/')).code).toBe(0)
  })

  it.each([
    'gh api -X PATCH repos/o/r/git/refs/heads/main -f sha=abc1234',
    'gh api -X PUT repos/o/r/git/refs/heads/main -f sha=abc1234',
    'gh api -X POST repos/o/r/git/refs/heads/main -f sha=abc1234',
    'gh api -X PATCH repos/o/r/git/refs/heads%2Fmain -f sha=abc1234 -F force=true',
    'gh api repos/o/r/git/refs/heads/main -f sha=abc1234',
    'gh api -X PATCH /repos/o/r/git/refs/heads/main/ -f sha=abc1234',
  ])('push direto na main pela API de refs bloqueia: %s', async (comando) => {
    const r = await bash(comando)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
  })

  it.each([
    'gh api -X PATCH repos/o/r/git/refs/heads/develop -f sha=abc1234',
    'gh api -X PATCH repos/o/r/git/refs/heads/feature/main -f sha=abc1234',
    'gh api -X PATCH repos/o/r/git/refs/heads/main-menu -f sha=abc1234',
    'gh api repos/o/r/git/refs/heads/main',
    'gh api -X GET repos/o/r/git/refs/heads/main',
  ])('API de refs que não escreve na main passa: %s', async (comando) => {
    expect((await bash(comando)).code).toBe(0)
  })

  // A1: o job `Validação (homolog)` é obrigatório na ponta, só com success; a consulta é pela ponta do PR.
  it.each([
    ['ausente na ponta (o success existe só na ponta do PR 30)', 45, 'situação: ausente'],
    ['skipped (obrigatório não aceita skipped)', 47, 'situação: skipped'],
    ['em andamento', 48, 'situação: em-andamento'],
    ['neutral (obrigatório não aceita neutral)', 49, 'situação: neutral'],
    ['duplicado: o de maior id (9) é failure, mesmo com success antigo (id 3)', 51, 'situação: failure'],
  ])('Validação (homolog) %s bloqueia', async (_nome, n, trecho) => {
    const r = await viaGh(n)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DE QA')
    expect(r.stderr).toContain("o check-run 'Validação (homolog)'")
    expect(r.stderr).toContain(trecho)
    expect(readFileSync(ghLog, 'utf8')).toContain(`repos/o/r/commits/abc00${n}/check-runs?filter=latest&per_page=100`)
    expect((await bash(`gh api -X PUT repos/o/r/pulls/${n}/merge -f merge_method=merge -f sha=abc00${n}`)).code).toBe(2)
  })

  it.each([
    ['duplicado: o de maior id (9) é success, o antigo (id 3) cancelled', 50],
    ['lint skipped e docs neutral (não obrigatórios aceitam), QA e Validação success', 53],
  ])('Validação (homolog) e demais checks passam: %s', async (_nome, n) => {
    expect((await viaGh(n)).code).toBe(0)
    expect((await bash(`gh api -X PUT repos/o/r/pulls/${n}/merge -f merge_method=merge -f sha=abc00${n}`)).code).toBe(0)
  })

  it('QA skipped (obrigatório só success) bloqueia pelo check QA, mesmo com a Validação success', async () => {
    const r = await viaGh(52)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DE QA')
    expect(r.stderr).toContain('o check QA do commit')
  })

  // A2: o merge só passa com a ponta conferida igual à ponta atual do PR (só pelo gh: o MCP bloqueia sempre na main).
  it.each([
    ['--match-head-commit abreviado', 'gh pr merge 30 --merge --match-head-commit abc003', 'não é a ponta atual'],
    ['sem --match-head-commit', 'gh pr merge 30 --merge', 'passe a ponta conferida'],
    ['--match-head-commit sem valor', 'gh pr merge 30 --merge --match-head-commit', 'passe a ponta conferida'],
    ['--match-head-commit defasado', 'gh pr merge 30 --merge --match-head-commit abc0029', 'não é a ponta atual'],
    ['--match-head-commit=defasado', 'gh pr merge 30 --merge --match-head-commit=abc0029', 'não é a ponta atual'],
    ['o último --match-head-commit vale', 'gh pr merge 30 --merge --match-head-commit abc0030 --match-head-commit abc0029', 'não é a ponta atual'],
    ['seletor de ramo, ponta defasada', 'gh pr merge ramo-main-verde --merge --match-head-commit abc0029', 'não é a ponta atual'],
    ['gh api sem sha', 'gh api -X PUT repos/o/r/pulls/30/merge -f merge_method=merge', 'passe a ponta conferida'],
    ['gh api com sha vazio', 'gh api -X PUT repos/o/r/pulls/30/merge -f merge_method=merge -f sha=', 'passe a ponta conferida'],
    ['gh api com sha defasado', 'gh api -X PUT repos/o/r/pulls/30/merge -f merge_method=merge -f sha=abc0029', 'não é a ponta atual'],
    ['gh api com dois sha diferentes', 'gh api -X PUT repos/o/r/pulls/30/merge -f merge_method=merge -f sha=abc0030 -f sha=abc0029', 'não é a ponta atual'],
    ['gh api com sha na query do endpoint', 'gh api -X PUT repos/o/r/pulls/30/merge?sha=abc0030 -f merge_method=merge -f sha=abc0030', 'não é a ponta atual'],
  ])('%s bloqueia', async (_nome, comando, trecho) => {
    const r = await bash(comando)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
    expect(r.stderr).toContain(trecho)
  })

  it('gh pr merge --admin bloqueia na main e em qualquer outra base', async () => {
    for (const comando of [
      `gh pr merge 30 --merge --admin ${pm30}`,
      `gh pr merge 30 --merge --admin=true ${pm30}`,
      'gh pr merge 1 --admin',
      'gh pr merge 2 --merge --admin',
    ]) {
      const r = await bash(comando)
      expect(r.code, comando).toBe(2)
      expect(r.stderr, comando).toContain('--admin')
    }
  })

  // B1: push direto na main também pelo ref sem `refs/`.
  it.each([
    'git push origin HEAD:heads/main',
    'git push origin heads/main',
    'git push origin +heads/main',
    'git push origin HEAD:refs/heads/main',
    'git push origin +HEAD:heads/main',
  ])('push com destino heads/main bloqueia: %s', async (comando) => {
    const r = await bash(comando)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
  })

  it.each([
    'git push origin feature/main-menu',
    'git push origin HEAD:heads/develop',
    'git push origin HEAD:heads/main-menu',
    'git push origin HEAD:heads/feature/main',
  ])('push que não toca a main passa: %s', async (comando) => {
    expect((await bash(comando)).code).toBe(0)
  })

  // B2: POST /merges funde uma branch na `base`; a base não pode ser a main nem escapar da linha de comando.
  it.each([
    'gh api repos/o/r/merges -f base=main -f head=feature/x',
    'gh api -X POST repos/o/r/merges -f base=main -f head=feature/x',
    'gh api -X POST repos/o/r/merges -f base=refs/heads/main -f head=feature/x',
    'gh api -X POST repos/o/r/merges -f base=heads/main -f head=feature/x',
    'gh api -X POST repos/o/r/merges -F base=@base.txt -f head=feature/x',
    'gh api -X POST repos/o/r/merges -f base=$B -f head=feature/x',
    'gh api -X POST repos/o/r/merges --input corpo.json',
    'gh api -X POST repos/o/r/merges -f head=feature/x',
    'gh api -X POST repos/o/r/merges/ -f head=feature/x',
    'gh api -X POST repos/o/r/merges -f base=feature/x -f base=main -f head=y',
  ])('POST /merges bloqueia: %s', async (comando) => {
    const r = await bash(comando)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
  })

  it('POST /merges com base de outra branch passa', async () => {
    expect((await bash('gh api repos/o/r/merges -f base=feature/x -f head=feature/y')).code).toBe(0)
    expect((await bash('gh api -X POST repos/o/r/merges -f base=develop -f head=feature/y')).code).toBe(0)
    expect((await bash('gh api -X GET repos/o/r/merges')).code).toBe(0)
  })

  // B3: PUT em /contents comita na `branch` do corpo; sem ela vai para a branch padrão, que é a main.
  it.each([
    'gh api -X PUT repos/o/r/contents/a.txt -f message=m -f content=Yw== -f branch=main',
    'gh api -X PUT repos/o/r/contents/a.txt -f message=m -f content=Yw== -f branch=refs/heads/main',
    'gh api -X PUT repos/o/r/contents/a.txt -f message=m -f content=Yw== -f branch=heads/main',
    'gh api -X PUT repos/o/r/contents/a.txt -f message=m -f content=Yw== -F branch=@x',
    'gh api -X PUT repos/o/r/contents/a.txt -f message=m -f content=Yw== -f branch=$B',
    'gh api -X PUT repos/o/r/contents/a.txt -f message=m -f content=Yw== -f branch=',
    'gh api -X PUT repos/o/r/contents/a.txt --input corpo.json',
    'gh api -X PUT repos/o/r/contents/a.txt -f message=m -f content=Yw==',
    'gh api -X PUT repos/o/r/contents/dir/a.txt?branch=feature/x -f message=m -f content=Yw==',
    'gh api -X PUT repos/o/r/contents/a.txt -f message=m -f branch=feature/x -f branch=main',
    'gh api -X DELETE repos/o/r/contents/a.txt -f message=m -f sha=abc1234',
    'gh api -X DELETE repos/o/r/contents/a.txt -f message=m -f branch=main',
  ])('escrita em /contents bloqueia: %s', async (comando) => {
    const r = await bash(comando)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
  })

  it('escrita em /contents com branch de outra branch passa; leitura passa', async () => {
    expect((await bash('gh api -X PUT repos/o/r/contents/a.txt -f message=m -f content=Yw== -f branch=feature/x')).code).toBe(0)
    expect((await bash('gh api -X PUT repos/o/r/contents/a.txt -f message=m -f content=Yw== -f branch=main-menu')).code).toBe(0)
    expect((await bash('gh api -X DELETE repos/o/r/contents/a.txt -f message=m -f sha=abc1234 -f branch=feature/x')).code).toBe(0)
    expect((await bash('gh api repos/o/r/contents/a.txt')).code).toBe(0)
  })

  // B4: GraphQL que escreve commit ou ref é push direto.
  it.each([
    'gh api graphql -f query=mutation{createCommitOnBranch(input:{}){commit{oid}}}',
    'gh api graphql -f query=mutation{updateRef(input:{}){clientMutationId}}',
    'gh api graphql -f query=mutation{updateRefs(input:{}){clientMutationId}}',
    'gh api graphql -f query=mutation{createRef(input:{}){clientMutationId}}',
  ])('mutação GraphQL de escrita bloqueia: %s', async (comando) => {
    const r = await bash(comando)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
  })

  it('consulta GraphQL (sem mutação de escrita) passa', async () => {
    expect((await bash('gh api graphql -f query=query{viewer{login}}')).code).toBe(0)
    expect((await bash("gh api graphql -f query='query { viewer { login } }'")).code).toBe(0)
    expect((await bash("gh api https://api.github.com/graphql -f query='query { viewer { login } }'")).code).toBe(0)
  })

  // Rodada 5: `analisar_comando` quebra em `(` e `)`, então a mutação com variáveis GraphQL não cabia num segmento só;
  // a checagem passou a olhar o comando inteiro e a bloquear o que o hook não consegue ler.
  it.each([
    "gh api graphql -f query='mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }' -F input=@x",
    "gh api graphql -f query='mutation($input: UpdateRefInput!) { updateRef(input: $input) { clientMutationId } }' -F input=@x",
    "gh api graphql -f query='mutation($input: UpdateRefsInput!) { updateRefs(input: $input) { clientMutationId } }' -F input=@x",
    "gh api graphql -f query='mutation($input: CreateRefInput!) { createRef(input: $input) { clientMutationId } }' -F input=@x",
    "gh api graphql -f query='mutation($input: MergePullRequestInput!) { mergePullRequest(input: $input) { clientMutationId } }' -F input=@x",
    "gh api graphql -f query='mutation($input: EnablePullRequestAutoMergeInput!) { enablePullRequestAutoMerge(input: $input) { clientMutationId } }' -F input=@x",
    "gh api graphql -f query='mutation { createCommitOnBranch (input: {}) { commit { oid } } }'",
    'gh api graphql -f query=@mutacao.graphql',
    'gh api graphql -F query=@mutacao.graphql',
    'gh api graphql --field query=@mutacao.graphql',
    'gh api graphql --input corpo.json',
    'gh api graphql --input=corpo.json',
    'gh api graphql -f query=$Q',
    'gh api graphql -f query="$Q"',
    'gh api graphql -f query="query { viewer { login } } $MUTACAO"',
    "gh api graphql -f query='query($o: String!) { repository(owner: $o, name: x) { id } }' -f o=o",
    'gh api graphql -f query=query{viewer{login}} -f x=$X',
  ])('GraphQL que escreve ou que o hook não consegue ler bloqueia: %s', async (comando) => {
    const r = await bash(comando)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DA MAIN: bloqueado.')
  })

  it('GraphQL deleteRef com variáveis também bloqueia, pela regra de branches', async () => {
    const r = await bash("gh api graphql -f query='mutation($input: DeleteRefInput!) { deleteRef(input: $input) { clientMutationId } }' -F input=@x")
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DE BRANCHES')
  })

  // Rodada 5: o endpoint como URL completa (github.com ou GHES com /api/v3) escapava das âncoras `^/?repos/` e `graphql`.
  it.each([
    'gh api -X PUT https://api.github.com/repos/o/r/pulls/30/merge -f merge_method=squash -f sha=abc0030',
    'gh api -X PUT https://api.github.com/repos/o/r/pulls/30/merge -f merge_method=merge',
    'gh api -X PUT https://api.github.com/repos/o/r/pulls/30/merge/ -f merge_method=merge',
    'gh api -X PUT https://ghe.exemplo.com/api/v3/repos/o/r/pulls/30/merge -f merge_method=squash -f sha=abc0030',
    'gh api -X PUT /api/v3/repos/o/r/pulls/30/merge -f merge_method=squash -f sha=abc0030',
    'gh api -X PUT //repos/o/r/pulls/30/merge -f merge_method=squash -f sha=abc0030',
    'gh api -X PUT https://api.github.com/repos/o/r/pulls/30/auto_merge -f merge_method=merge',
    'gh api https://api.github.com/repos/o/r/merges -f base=main -f head=feature/x',
    'gh api https://ghe.exemplo.com/api/v3/repos/o/r/merges -f base=main -f head=feature/x',
    'gh api /api/v3/repos/o/r/merges -f base=main -f head=feature/x',
    'gh api https://api.github.com/repos/o/r/merges -f head=feature/x',
    'gh api -X PUT https://api.github.com/repos/o/r/contents/a.txt -f message=m -f content=Yw==',
    'gh api -X PUT https://api.github.com/repos/o/r/contents/a.txt -f message=m -f branch=main',
    'gh api -X PATCH https://api.github.com/repos/o/r/git/refs/heads/main -f sha=abc1234',
    "gh api https://api.github.com/graphql -f query='mutation($input: CreateRefInput!) { createRef(input: $input) { clientMutationId } }'",
    'gh api https://api.github.com/graphql -f query=@mutacao.graphql',
    'gh api https://api.github.com/graphql --input corpo.json',
    'gh api /graphql -f query=@mutacao.graphql',
    'gh api -X PATCH https://api.github.com/repos/o/r/pulls/1 -f base=main',
  ])('endpoint em URL completa ou com barra inicial não escapa: %s', async (comando) => {
    const r = await bash(comando)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
  })

  // Rodada 6: permissão estreita. `gh api graphql` só passa como consulta literal de leitura, vista no comando inteiro.
  it.each([
    'gh api graphql -f query="`cat m.graphql`"',
    'gh api graphql -f query=`cat m.graphql`',
    'gh api graphql -f query="$(cat m)"',
    'gh api graphql -f query=query{a} < <(cat m)',
    'gh api graphql -f query=',
    'gh api graphql -f query="" ',
    'gh api graphql -f outro=x',
    'gh api graphql',
    'gh api graphql -f query=query{a} -f query=query{b}',
    'gh api graphql -f query=query{a} -F query=query{b}',
    'gh api graphql -f query=MUTATION{x}',
    'gh api graphql -f query=Mutation{x}',
    'gh api graphql -f query="query { viewer { login } } mUtAtIoN { x }"',
    'gh api graphql -f query=subscription{x}',
    'gh api graphql -f query=fragment{x}',
    'gh api graphql -f query=x{a}',
    'gh api graphql -f query=queryA{a} -f email=a@b.c',
    'gh api graphql -f query=query{a} --input corpo.json',
    'gh api graphql -F query=@q.graphql',
    'echo mutation; gh api graphql -f query=query{a}',
  ])('graphql fora da permissão estreita bloqueia: %s', async (comando) => {
    const r = await bash(comando)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
    expect(r.stderr).toContain('GraphQL')
  })

  it.each([
    "gh api graphql -f query='query { viewer { login } }'",
    "gh api graphql -F query='query { viewer { login } }'",
    "gh api graphql --field query='query { viewer { login } }'",
    "gh api graphql --raw-field query='query { viewer { login } }'",
    "gh api graphql -f query='{ viewer { login } }'",
    "gh api graphql -fquery='query { viewer { login } }'",
    "gh api https://api.github.com/graphql -f query='query { viewer { login } }'",
    "gh api /graphql -f query='query { viewer { login } }'",
    "gh api ./graphql -f query='query { viewer { login } }'",
    "gh api GraphQL -f query='query { viewer { login } }'",
    "gh api https://ghe.exemplo.com/api/v3/graphql -f query='query { viewer { login } }'",
    'gh api graphql -f query=query{viewer{login}}',
  ])('graphql de leitura literal passa: %s', async (comando) => {
    expect((await bash(comando)).code).toBe(0)
  })

  it.each([
    './graphql',
    'GraphQL',
    'GRAPHQL/',
    '/./graphql',
    'https://API.github.com/GraphQL',
  ])('endpoint %s é normalizado antes de casar: mutação bloqueia', async (endpoint) => {
    const r = await bash(`gh api ${endpoint} -f query=mutation{createRef{x}}`)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
  })

  it.each([
    'gh api ./repos/o/r/merges -f base=main -f head=feature/x',
    'gh api Repos/O/R/Merges -f base=main -f head=feature/x',
    'gh api -X PUT ./repos/o/r/contents/a.txt -f message=m -f content=Yw==',
    'gh api -X PUT repos/o/r/pulls/30/Merge -f merge_method=squash -f sha=abc0030',
    'gh api -X PUT ./repos/o/r/pulls/30/merge -f merge_method=squash -f sha=abc0030',
    'gh api -X PATCH ./repos/o/r/git/refs/heads/main -f sha=abc1234',
    'gh api -X PATCH Repos/o/r/git/Refs/heads/main -f sha=abc1234',
  ])('caixa e ./ no endpoint não escapam: %s', async (comando) => {
    const r = await bash(comando)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
  })

  it('endpoint em URL completa: apagar branch protegida continua bloqueando; o merge elegível e a base de outra branch passam', async () => {
    const apaga = await bash('gh api -X DELETE https://api.github.com/repos/o/r/git/refs/heads/main')
    expect(apaga.code).toBe(2)
    expect(apaga.stderr).toContain('GATE DE BRANCHES')
    expect((await bash('gh api -X PUT https://api.github.com/repos/o/r/pulls/30/merge -f merge_method=merge -f sha=abc0030')).code).toBe(0)
    expect((await bash('gh api -X PUT https://ghe.exemplo.com/api/v3/repos/o/r/pulls/30/merge -f merge_method=merge -f sha=abc0030')).code).toBe(0)
    expect((await bash('gh api https://api.github.com/repos/o/r/merges -f base=feature/x -f head=feature/y')).code).toBe(0)
    expect((await bash('gh api -X PUT https://api.github.com/repos/o/r/contents/a.txt -f message=m -f branch=feature/x')).code).toBe(0)
  })

  it('auto-merge na main bloqueia sempre, mesmo com o PR 30 elegível: pelo MCP (caminho do gh na mensagem) e pelo gh', async () => {
    const r = await mcp('enable_pr_auto_merge', pr(30))
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('gh pr merge <N> --merge --match-head-commit <sha>')
    expect((await mcp('enable_pr_auto_merge', { ...pr(30), merge_method: 'merge' })).code).toBe(2)
    const cli = await bash(`gh pr merge 30 --merge --auto ${pm30}`)
    expect(cli.code).toBe(2)
    expect(cli.stderr).toContain('auto-merge')
  })

  it('a via estreita não afrouxa a develop nem a homolog: --delete-branch e squash continuam passando nelas', async () => {
    expect((await bash('gh pr merge 1 --squash --delete-branch')).code).toBe(0)
    expect((await bash('gh pr merge 2 --rebase')).code).toBe(0)
    expect((await mcp('merge_pull_request', { ...pr(1), merge_method: 'squash' })).code).toBe(0)
  })
})

// `git push` sem destino explícito (ou com destino HEAD/@/vazio) vai para o branch atual: o hook resolve o branch com um
// `git symbolic-ref` no diretório em que roda, então estes testes usam repositórios git de verdade como cwd.
describe('gate-main: git push sem destino explícito resolve o branch atual', () => {
  const msgMain = 'GATE DA MAIN: bloqueado.'
  let base = ''
  let naMain = ''
  let naFeature = ''
  let destacado = ''
  let semRepo = ''

  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' })
    expect(r.status, args.join(' ')).toBe(0)
  }
  const criar = (nome: string, ramo: string) => {
    const pasta = join(base, nome)
    mkdirSync(pasta)
    git(pasta, 'init', '-q')
    git(pasta, 'symbolic-ref', 'HEAD', `refs/heads/${ramo}`)
    return pasta
  }

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'gittools-gatemain-push-'))
    naMain = criar('na-main', 'main')
    naFeature = criar('na-feature', 'feature/x')
    destacado = criar('destacado', 'main')
    git(destacado, 'commit', '-q', '--allow-empty', '-m', 'x')
    git(destacado, 'checkout', '-q', '--detach')
    semRepo = join(base, 'sem-repo')
    mkdirSync(semRepo)
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })

  it.each([
    'git push',
    'git push origin',
    'git push -u origin',
    'git push origin HEAD',
    'git push -u origin HEAD',
    'git push origin @',
    'git push origin HEAD:',
    'git push origin +HEAD',
    'git push --force-with-lease origin HEAD',
    'git push \\\n  origin \\\n  HEAD',
  ])('com o checkout na main bloqueia: %s', async (comando) => {
    const r = await bash(comando, naMain)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
    expect(r.stderr).toContain('checkout na main')
  })

  it.each([
    'git push',
    'git push origin',
    'git push -u origin HEAD',
    'git push origin @',
    'git push origin HEAD:',
    'git push origin HEAD:feature/x',
    'git push \\\n  origin \\\n  HEAD',
  ])('com o checkout em feature/x passa: %s', async (comando) => {
    expect((await bash(comando, naFeature)).code).toBe(0)
  })

  it('refspec explícito de outro branch passa mesmo com o checkout na main, sem consultar o git', async () => {
    for (const comando of ['git push origin feature/x', 'git push -u origin feature/x', 'git push origin HEAD:feature/x', 'git push --tags', 'git push origin --delete feature/x']) {
      expect((await bash(comando, naMain)).code, comando).toBe(0)
    }
  })

  it('HEAD destacado não é a main: passa; fora de um repositório (a consulta falha) bloqueia', async () => {
    expect((await bash('git push origin HEAD', destacado)).code).toBe(0)
    expect((await bash('git push', destacado)).code).toBe(0)
    const r = await bash('git push origin HEAD', semRepo)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('não foi possível resolver o branch atual')
    expect((await bash('git push', semRepo)).code).toBe(2)
    // Com destino explícito o git nem é consultado: fora de repositório também passa.
    expect((await bash('git push origin feature/x', semRepo)).code).toBe(0)
  })

  it('git -C resolve o branch no diretório do -C, não no do hook', async () => {
    expect((await bash(`git -C ${naMain} push`, naFeature)).code).toBe(2)
    expect((await bash(`git -C ${naMain} push origin HEAD`, naFeature)).code).toBe(2)
    expect((await bash(`git -C ${naFeature} push`, naMain)).code).toBe(0)
  })

  it.each([
    'git push origin refs/heads/*:refs/heads/*',
    'git push origin +refs/heads/*:refs/heads/*',
    "git push origin 'refs/heads/*:refs/heads/*'",
    'git push origin *:main',
    'git push origin refs/heads/*:refs/heads/x*',
    'git push origin :',
    'git push origin +:',
  ])('refspec com curinga ou ":" bloqueia, mesmo com o checkout em feature/x: %s', async (comando) => {
    const r = await bash(comando, naFeature)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
  })

  it('continuação de linha com `\\` é juntada antes de segmentar, para qualquer comando', async () => {
    // Sem juntar, `git push origin \` (checkout em feature/x: passa) e `main` (não é comando) escapavam.
    const r = await bash('git push origin \\\n main', naFeature)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('destino na main')
    expect((await bash('gh pr merge 30 \\\n --squash \\\n --match-head-commit abc0030')).code).toBe(2)
    expect((await bash('gh pr merge 30 \\\n --merge \\\n --match-head-commit abc0030')).code).toBe(0)
    expect((await bash('gh api -X PUT \\\n repos/o/r/pulls/30/merge \\\n -f merge_method=squash -f sha=abc0030')).code).toBe(2)
  })

  // `git push -o x origin`: o valor de -o contava como refspec (npos 2), então o push sem destino passava na main.
  it.each([
    'git push -o ci.skip origin',
    'git push --push-option ci.skip origin',
    'git push --push-option=ci.skip origin',
    'git push -o ci.skip -o b origin',
    'git push -uo ci.skip origin',
    'git push -fo ci.skip origin',
    'git push --repo origin',
    'git push --receive-pack x origin',
  ])('o valor de opção que leva argumento não conta como refspec: bloqueia na main, passa em feature/x: %s', async (comando) => {
    const r = await bash(comando, naMain)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('checkout na main')
    expect((await bash(comando, naFeature)).code).toBe(0)
  })

  it('git push -o com refspec explícito de outro branch passa mesmo na main', async () => {
    expect((await bash('git push -o ci.skip origin feature/x', naMain)).code).toBe(0)
  })

  // Prazo global: o git que resolve o branch também falha fechado (status 124, não o 1 do HEAD destacado).
  it('prazo global esgotado antes do git push sem destino bloqueia, mesmo no checkout em feature/x', async () => {
    const comando = 'gh pr merge 1 --merge && git push'
    expect((await bash(comando, naFeature)).code).toBe(0)
    // Relógio simulado (GATE_MAIN_SECONDS_FAKE): o prazo já passou quando o git seria consultado.
    expect((await bash('git push', naFeature, { GATE_MAIN_SECONDS_FAKE: '80' })).code).toBe(0)
    const lento = await bash('git push', naFeature, { GATE_MAIN_SECONDS_FAKE: '90' })
    expect(lento.code).toBe(2)
    expect(lento.stderr).toContain('Prazo do hook esgotado')
    expect(lento.stderr).toContain('não foi possível resolver o branch atual')
  })

  it('--all e --mirror continuam barrados', async () => {
    expect((await bash('git push --all origin', naFeature)).code).toBe(2)
    expect((await bash('git push --mirror origin', naFeature)).code).toBe(2)
  })
})

describe('gate-main: caminho comum', () => {
  it('outra ferramenta passa', async () => {
    expect((await rodar('Read', { file_path: '/tmp/x' })).code).toBe(0)
  })

  it('comando Bash que não é de git nem de gh passa sem chamar o gh', async () => {
    expect((await bash('ls -la && npm run typecheck')).code).toBe(0)
    expect(existsSync(ghLog)).toBe(false)
  })
})
