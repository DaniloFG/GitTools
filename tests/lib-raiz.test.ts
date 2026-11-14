import { spawnSync } from 'node:child_process'
import { copyFileSync, readdirSync, readFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { linkOrSkip } from './helpers'

// lib-raiz.sh (#199): formato único de caminho dos hooks. No Windows o git devolve "C:/..." e o Git Bash "/c/...", e o
// mesmo diretório tem grafia curta (8.3) e longa; aqui isso é simulado com funções puras e com link simbólico.
const lib = fileURLToPath(new URL('../.claude/hooks/lib-raiz.sh', import.meta.url))

// Caminho no formato do Git Bash (C:\\x -> /c/x): o mesmo que para_posix faz; fora do Windows não muda nada.
const posix = (c: string) => c.replace(/\\/g, '/').replace(/^([A-Za-z]):(\/|$)/, (_m, d: string, r: string) => `/${d.toLowerCase()}${r}`)

function bash(script: string, env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync('bash', ['-c', `. "${lib}"; ${script}`], { encoding: 'utf8', env: { ...process.env, ...env } })
  return { status: r.status, out: r.stdout }
}

describe('para_posix', () => {
  it.each([
    ['C:\\Users\\x\\wt', '/c/Users/x/wt'],
    ['C:/Users/x/wt', '/c/Users/x/wt'],
    ['d:', '/d'],
    ['/c/Users/x', '/c/Users/x'],
    ['/tmp/a b', '/tmp/a b'],
    ['relativo/x', 'relativo/x'],
  ])('%s -> %s', (entrada, esperado) => {
    expect(bash('para_posix "$1"'.replace('"$1"', JSON.stringify(entrada).replace(/\$/g, '\\$'))).out).toBe(esperado)
  })
})

describe('marcador_da_raiz e raiz_de_trabalho', () => {
  let base = ''
  let raiz = ''
  beforeEach(() => {
    base = realpathSync.native(mkdtempSync(join(tmpdir(), 'gittools-libraiz-')))
    raiz = join(base, 'repo')
    mkdirSync(join(raiz, '.claude'), { recursive: true })
  })
  afterEach(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

  it('aceita só issue.local e triagem.local dentro do .claude da raiz', () => {
    const ok = (p: string) => bash(`marcador_da_raiz "${posix(p)}" "${posix(raiz)}"`).status === 0
    expect(ok(`${raiz}/.claude/issue.local`)).toBe(true)
    expect(ok(`${raiz}/.claude/triagem.local`)).toBe(true)
    expect(ok(`${raiz}/.claude/outro.local`)).toBe(false)
    expect(ok(`${raiz}/src/issue.local`)).toBe(false)
    expect(ok(`${base}/outro/.claude/issue.local`)).toBe(false)
  })

  it('reconhece o mesmo .claude por outra grafia (link), mas não um .claude de outra pasta', (ctx) => {
    mkdirSync(join(base, 'outro', '.claude'), { recursive: true })
    mkdirSync(join(base, 'alias'))
    linkOrSkip(ctx, join(raiz, '.claude'), join(base, 'alias', '.claude'), 'dir')
    const ok = (p: string) => bash(`marcador_da_raiz "${posix(p)}" "${posix(raiz)}"`).status
    expect(ok(`${base}/alias/.claude/issue.local`)).toBe(0)
    expect(ok(`${base}/outro/.claude/issue.local`)).toBe(1)
  })

  it('raiz_de_trabalho: git que diz a mesma pasta de outra grafia é o mesmo repositório; pasta diferente não', (ctx) => {
    const git = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: raiz })
    git('init', '-q')
    git('commit', '-q', '--allow-empty', '-m', 'b')
    const wt = join(base, 'wt')
    expect(git('worktree', 'add', '-q', '-b', 'x', wt).status).toBe(0)
    // git de mentira: a pasta comum do worktree sai por um link (outra grafia do mesmo diretório).
    const apelido = join(base, 'apelido-git')
    linkOrSkip(ctx, join(raiz, '.git'), apelido, 'dir')
    // O git de mentira é uma FUNÇÃO do bash (sombreia o comando, sem arquivo nem PATH: funciona igual no Git Bash).
    const roda = (comum: string) =>
      bash(
        `git() { if [ "$1" = -C ] && [ "$2" = "$WT" ]; then case "$*" in *--git-common-dir*) echo "$GIT_COMUM"; return 0;; esac; fi; command git "$@"; }; ` +
          `raiz_de_trabalho "${posix(wt)}/src/a.ts" "${posix(raiz)}"`,
        { WT: posix(wt), GIT_COMUM: posix(comum) },
      )
    // Sem o git de mentira a função também aceita (mesma pasta): confirma que o caso base funciona antes do falso.
    expect(bash(`raiz_de_trabalho "${posix(wt)}/src/a.ts" "${posix(raiz)}"`)).toEqual({ status: 0, out: posix(wt) })
    expect(roda(apelido)).toEqual({ status: 0, out: posix(wt) })
    mkdirSync(join(base, 'outro-git'))
    expect(roda(join(base, 'outro-git')).status).toBe(1)
  })
})

// O macOS traz o bash 3.2: os hooks rodam em quem usa macOS e não podem usar construção do bash 4 ou posterior (`${x,,}`
// falhava lá e devolvia vazio). Cada padrão abaixo é de uma versão acima da 3.2; `${!x}` (bash 2) e `printf -v` (3.1) são
// aceitos pelo 3.2 e ficam de fora.
const proibidos: [string, RegExp][] = [
  ['${x,,} ${x^^} ${x,} ${x^} (caixa)', /\$\{[A-Za-z_0-9]+(,,|\^\^|,|\^)[^}]*\}/],
  ['${x@Q|E|P|A|a|U|u|L|K} (transformação)', /\$\{[A-Za-z_0-9]+@[A-Za-z]\}/],
  ['declare/local/typeset -A -l -u -n', /\b(declare|local|typeset)\s+-[a-zA-Z]*[Alun]/],
  ['mapfile / readarray', /\b(mapfile|readarray)\b/],
  ['read -N / read -i', /\bread\s+(-[a-zA-Z]+\s+)*-[a-zA-Z]*[Ni]\b/],
  ['wait -n', /\bwait\s+-n\b/],
  ['$BASHPID $EPOCHSECONDS $EPOCHREALTIME $SRANDOM', /\$\{?(BASHPID|EPOCHSECONDS|EPOCHREALTIME|SRANDOM)\b/],
  ['${arr[-1]} (índice negativo)', /\$\{[A-Za-z_0-9]+\[-[0-9]/],
  ['{1..9..2} (incremento em chaves)', /\{[0-9A-Za-z]+\.\.[0-9A-Za-z]+\.\.-?[0-9]+\}/],
  ['shopt -s globstar|lastpipe|autocd|dirspell|direxpand|checkjobs|compatNN', /\bshopt\s+-s\s+[^\n]*\b(globstar|lastpipe|autocd|dirspell|direxpand|checkjobs|compat\d+)\b/],
  ['|& e &>>', /\|&|&>>/],
  ['coproc', /\bcoproc\b/],
  ['[[ -v x ]]', /\[\[\s+-v\s/],
  ['case com ;& ou ;;&', /;;&|;&\s*$/m],
]

// Tira o comentário da linha: `#` no começo de palavra e fora de aspas (aspas simples e duplas contadas na ordem). Limite
// conhecido: não entende `\#`, `$#` nem heredoc; os hooks não os usam em linha que traga construção proibida.
function semComentario(linha: string): string {
  let aspa = ''
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i]
    if (aspa) {
      if (c === aspa) aspa = ''
    } else if (c === "'" || c === '"') {
      aspa = c
    } else if (c === '#' && (i === 0 || /\s/.test(linha[i - 1]))) {
      return linha.slice(0, i)
    }
  }
  return linha
}

describe('hooks em bash 3.2 (macOS)', () => {
  const pasta = fileURLToPath(new URL('../.claude/hooks/', import.meta.url))
  const acha = (codigo: string) => proibidos.filter(([, re]) => re.test(codigo)).map(([nome]) => nome)

  it('o guarda reprova cada construção proibida e aceita as do bash 3.2', () => {
    for (const ruim of [
      'x=${d,,}', 'x=${d^^}', 'x=${d,}', 'x=${d@Q}', 'x=${d@a}', 'declare -A m', 'local -n r=x', 'declare -l v', 'mapfile -t a',
      'read -N 3 x', 'read -r -i abc x', 'wait -n', 'echo $BASHPID', 'echo "$EPOCHSECONDS"', 'echo "${a[-1]}"', 'for i in {1..9..2}; do :; done',
      'shopt -s globstar', 'shopt -s nocasematch lastpipe', 'a |& b', 'a &>> f', 'coproc x { :; }', '[[ -v v ]]',
    ]) {
      expect(acha(semComentario(ruim)), ruim).not.toEqual([])
    }
    for (const bom of [
      'x=${!nome}', 'printf -v x "%s" y', 'shopt -s nocasematch', 'read -r -d "" x', 'local -r y=1', 'x=${a:-b,c}', 'declare -a arr',
      'cmd # |& ${d,,} mapfile', 'echo "a # b" # ${d,,}', 'echo ${#x}', 'for i in {1..9}; do :; done',
    ]) {
      expect(acha(semComentario(bom)), bom).toEqual([])
    }
  })

  // No Windows o Node chama `bash C:\\x\\hook.sh`: sem `/` no caminho, `${BASH_SOURCE[0]%/*}` devolve o caminho inteiro e a
  // lib não é achada (o autosave ignorava o worktree em silêncio). O diretório do hook sai de expansão do bash, sem `%/*` solto.
  it('nenhum hook acha o próprio diretório com ${BASH_SOURCE[0]%/*}', () => {
    for (const arquivo of readdirSync(pasta).filter((f) => f.endsWith('.sh'))) {
      const codigo = readFileSync(join(pasta, arquivo), 'utf8').split('\n').map(semComentario).join('\n')
      expect(codigo, arquivo).not.toMatch(/\$\{BASH_SOURCE(\[0\])?%/)
    }
  })

  // O autosave roda a cada PostToolUse e o limitador de carimbo (a linha `if ... carimbo_fresco "$carimbo"`) tem de vir antes
  // de qualquer comando externo de texto: nada de dirname/basename/sed/awk/tr/cut/head/tail/cat/readlink/realpath/date na
  // parte que vem antes dele, só expansão do bash (`pwd`/`cd` embutidos e o `git rev-parse` do caminho sem CLAUDE_PROJECT_DIR,
  // que já existia). A ÚNICA exceção é `agora=$(date +%s)`: bash 3.2 não tem relógio sem processo e o limitador precisa dele.
  // Qualquer outro `date` ou comando de texto reprova. Limite do guarda: texto, não execução.
  const ancoraLimitador = 'if [ "$limitado" = 1 ] && carimbo_fresco "$carimbo"'
  const relogio = 'agora=$(date +%s)'
  it('autosave.sh não chama comando externo de texto antes do limitador', () => {
    // CRLF (checkout do Windows) não pode quebrar a igualdade de linha com o relógio.
    const codigo = readFileSync(join(pasta, 'autosave.sh'), 'utf8').replace(/\r\n/g, '\n')
    const ancora = codigo.indexOf(ancoraLimitador)
    // Sem a âncora, o slice pegaria o arquivo inteiro em silêncio: a guarda reprova antes de medir.
    expect(ancora, 'âncora do limitador sumiu do autosave.sh').toBeGreaterThan(0)
    const linhas = codigo.slice(0, ancora).split('\n').map(semComentario)
    expect(linhas.filter((l) => l === relogio), 'linhas do relógio antes do limitador').toHaveLength(1)
    const antes = linhas.filter((l) => l !== relogio).join('\n')
    expect(antes.length).toBeGreaterThan(200)
    expect(antes).not.toMatch(/\b(dirname|basename|sed|awk|tr|cut|head|tail|cat|readlink|realpath|date)\b/)
    expect(antes).not.toMatch(/`/)
  })

  // O pré-limitador do worktree (#208) tem de rodar ANTES da resolução da raiz, que é o que abria os processos git.
  it('autosave.sh tem o pré-limitador do worktree antes da resolução da raiz', () => {
    const codigo = readFileSync(join(pasta, 'autosave.sh'), 'utf8').replace(/\r\n/g, '\n').split('\n').map(semComentario).join('\n')
    const preLimitador = codigo.indexOf('carimbo_fresco "$raiz_projeto/.claude/worktrees/')
    const resolucao = codigo.indexOf('raiz_de_trabalho "$atual"')
    expect(preLimitador).toBeGreaterThanOrEqual(0)
    expect(resolucao).toBeGreaterThanOrEqual(0)
    expect(preLimitador).toBeLessThan(resolucao)
  })

  // Windows: o Node chama `bash C:\x\autosave.sh`, sem `/`. No Linux um arquivo cujo NOME tem `\` reproduz o mesmo
  // BASH_SOURCE: `hooks\autosave.sh` com a lib em `hooks/`. Sem a troca de `\` por `/` a lib não era achada.
  it('autosave.sh acha a lib quando o caminho do script tem só barra invertida', () => {
    const raizTeste = mkdtempSync(join(tmpdir(), 'gittools-autosave-bs-'))
    try {
      mkdirSync(join(raizTeste, 'hooks'))
      copyFileSync(join(pasta, 'lib-raiz.sh'), join(raizTeste, 'hooks', 'lib-raiz.sh'))
      copyFileSync(join(pasta, 'autosave.sh'), join(raizTeste, 'hooks\\autosave.sh'))
      const repo = join(raizTeste, 'repo')
      mkdirSync(repo)
      const g = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo })
      g('init', '-q')
      mkdirSync(join(repo, '.claude'))
      const r = spawnSync('bash', ['hooks\\autosave.sh'], {
        cwd: raizTeste,
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: repo, AUTOSAVE_DEBUG: '1' },
      })
      expect(r.status).toBe(0)
      const log = readFileSync(join(repo, '.claude', 'autosave.log'), 'utf8')
      expect(log).toContain('contexto:')
      expect(log).not.toContain('lib-raiz.sh não encontrada')
    } finally {
      rmSync(raizTeste, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  })

  for (const arquivo of readdirSync(pasta).filter((f) => f.endsWith('.sh'))) {
    it(`${arquivo} não usa construção do bash 4+`, () => {
      const codigo = readFileSync(join(pasta, arquivo), 'utf8').split('\n').map(semComentario).join('\n')
      expect(acha(codigo)).toEqual([])
    })
  }
})
