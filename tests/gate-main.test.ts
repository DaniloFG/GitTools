import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    */commits/abc0030/check-runs*) runs "$qa_ok,$lint_ok" 2 ;;
    */commits/abc0036/check-runs*) runs '{"name":"QA","id":7,"status":"completed","conclusion":"failure"},'"$lint_ok" 2 ;;
    */commits/abc0037/check-runs*) runs "$qa_ok"',{"name":"lint","id":8,"status":"completed","conclusion":"failure"}' 2 ;;
    */commits/abc0038/check-runs*) runs "$qa_ok"',{"name":"lint","id":8,"status":"in_progress","conclusion":null}' 2 ;;
    */commits/abc0039/check-runs*) runs "$qa_ok"',{"name":"lint","id":8,"status":"completed","conclusion":"cancelled"}' 2 ;;
    */commits/abc0040/check-runs*) runs "$qa_ok,$lint_ok" 3 ;;
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

async function rodar(toolName: string, toolInput: Record<string, unknown>) {
  const r = await executar('bash', [script], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
    env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`, GH_LOG: ghLog },
  })
  return { code: r.status, stderr: r.stderr }
}

const bash = (command: string) => rodar('Bash', { command })
const mcp = (nome: string, entrada: Record<string, unknown>) => rodar(`mcp__github__${nome}`, entrada)
const pr = (numero: number) => ({ owner: 'o', repo: 'r', pullNumber: numero })

describe('gate-main: GitHub MCP', () => {
  it.each([1, 2])('merge do PR %i (base develop/homolog) passa', async (n) => {
    expect((await mcp('merge_pull_request', pr(n))).code).toBe(0)
  })

  it('merge do PR 3 (base main, origem fix/x) bloqueia pela origem, com mensagem em português', async () => {
    const r = await mcp('merge_pull_request', { ...pr(3), merge_method: 'merge' })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DA MAIN')
    expect(r.stderr).toContain('a main só recebe a homolog (origem do PR: fix/x)')
    expect(r.stderr).toContain('Via estreita da main')
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
    const r = await mcp('merge_pull_request', { ...pr(3), merge_method: 'merge' })
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
    const r = await mcp('merge_pull_request', { ...pr(3), merge_method: 'merge' })
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
  const merge = { merge_method: 'merge' }
  const msgMain = 'GATE DA MAIN: bloqueado.'

  it('PR 30 (homolog, os dois rótulos, clean, checks verdes, merge commit) passa por MCP, gh pr merge e gh api', async () => {
    expect((await mcp('merge_pull_request', { ...pr(30), ...merge })).code).toBe(0)
    expect((await bash('gh pr merge 30 --merge')).code).toBe(0)
    expect((await bash('gh pr merge 30 -m')).code).toBe(0)
    expect((await bash('gh api -X PUT repos/o/r/pulls/30/merge -f merge_method=merge')).code).toBe(0)
    const log = readFileSync(ghLog, 'utf8')
    expect(log).toContain('repos/o/r/commits/abc0030/check-runs?check_name=QA')
    expect(log).toContain('repos/o/r/commits/abc0030/check-runs?filter=latest&per_page=100')
  })

  it('por seletor de ramo: homolog com CLEAN passa; origem fix/x bloqueia', async () => {
    expect((await bash('gh pr merge ramo-main-verde --merge')).code).toBe(0)
    expect(readFileSync(ghLog, 'utf8')).toContain('repos/{owner}/{repo}/commits/abc0030/check-runs?filter=latest&per_page=100')
    const r = await bash('gh pr merge ramo-main-fix --merge')
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('a main só recebe a homolog (origem do PR: fix/x)')
    expect((await bash('gh pr merge ramo-main-verde')).code).toBe(2)
    expect((await bash('gh pr merge ramo-main-verde --merge -R github.com/o/r')).code).toBe(2)
  })

  it.each([
    ['origem develop', 31, 'origem do PR: develop'],
    ['origem fix/x', 32, 'origem do PR: fix/x'],
    ['falta validada-develop', 33, 'validada-develop'],
    ['falta validada-homolog', 34, 'validada-homolog'],
    ['mergeable_state dirty', 35, 'mergeable_state: dirty'],
  ])('bloqueia por %s, sem consultar checks', async (_nome, n, trecho) => {
    const r = await mcp('merge_pull_request', { ...pr(n), ...merge })
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
    const r = await mcp('merge_pull_request', { ...pr(n), ...merge })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('GATE DE QA')
    expect(r.stderr).toContain(trecho)
  })

  it('falha fechada: a consulta de origem, rótulos e estado falha (PR 41)', async () => {
    const r = await mcp('merge_pull_request', { ...pr(41), ...merge })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
    expect(r.stderr).toContain('não foi possível obter origem, ponta, rótulos e estado')
  })

  it.each([
    ['squash', 'squash'],
    ['rebase', 'rebase'],
    ['ausente', undefined],
    ['vazio', ''],
  ])('MCP com merge_method %s bloqueia, sem consultar os checks', async (_nome, metodo) => {
    const r = await mcp('merge_pull_request', metodo === undefined ? pr(30) : { ...pr(30), merge_method: metodo })
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
    expect((await bash('gh api -X PUT repos/o/r/pulls/30/merge -fmerge_method=merge')).code).toBe(0)
    expect((await bash('gh api -X PUT repos/o/r/pulls/30/merge -Fmerge_method=merge')).code).toBe(0)
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
    expect((await bash('gh pr merge 30 --merge -Ro/r')).code).toBe(0)
    expect((await bash('gh pr merge 30 -Ro/r --merge')).code).toBe(0)
    expect(readFileSync(ghLog, 'utf8')).toContain('repos/o/r/pulls/30')
    expect((await bash('gh pr merge 30 -Ro/r')).code).toBe(2)
    expect((await bash('gh pr merge ramo-main-verde --merge -Rgithub.com/o/r')).code).toBe(2)
    expect((await bash('gh pr merge ramo-main-verde --merge -Ro/r')).code).toBe(0)
  })

  it.each([
    ['head.repo de fork com ref homolog', 43],
    ['head.repo null (fork apagado)', 44],
  ])('PR de outro repositório bloqueia, mesmo com ref homolog e tudo verde: %s', async (_nome, n) => {
    const r = await mcp('merge_pull_request', { ...pr(n), ...merge })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(msgMain)
    expect(r.stderr).toContain('fork')
    expect(readFileSync(ghLog, 'utf8')).not.toContain('check-runs')
    expect((await bash(`gh pr merge ${n} --merge`)).code).toBe(2)
    expect((await bash(`gh api -X PUT repos/o/r/pulls/${n}/merge -f merge_method=merge`)).code).toBe(2)
  })

  it('por seletor, isCrossRepository true (fork) bloqueia', async () => {
    const r = await bash('gh pr merge ramo-main-fork --merge')
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
    expect((await bash('gh api -X=PUT repos/o/r/pulls/30/merge -f merge_method=merge')).code).toBe(0)
    expect((await bash('gh api -X=put repos/o/r/pulls/30/merge -f=merge_method=merge')).code).toBe(0)
    expect((await bash('gh api -X PUT repos/o/r/pulls/30/merge -F=merge_method=merge')).code).toBe(0)
    expect((await bash('gh pr merge 30 --merge -R=o/r')).code).toBe(0)
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
    expect((await bash('timeout 60 gh pr merge 30 --merge')).code).toBe(0)
    expect((await bash('bash -ec "gh pr merge 30 --merge"')).code).toBe(0)
    expect((await bash('{ gh pr merge 30 --merge; }')).code).toBe(0)
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
    expect((await bash('gh api -X PUT repos/o/r/pulls/30/merge/ -f merge_method=merge')).code).toBe(0)
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

  it('auto-merge na main bloqueia sempre, mesmo com o PR 30 elegível; o método não importa', async () => {
    const r = await mcp('enable_pr_auto_merge', pr(30))
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('auto-merge')
    expect((await mcp('enable_pr_auto_merge', { ...pr(30), ...merge })).code).toBe(2)
  })

  it('a via estreita não afrouxa a develop nem a homolog: --delete-branch e squash continuam passando nelas', async () => {
    expect((await bash('gh pr merge 1 --squash --delete-branch')).code).toBe(0)
    expect((await bash('gh pr merge 2 --rebase')).code).toBe(0)
    expect((await mcp('merge_pull_request', { ...pr(1), merge_method: 'squash' })).code).toBe(0)
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
