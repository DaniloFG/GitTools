import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
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
    const bin = join(base, 'bin')
    mkdirSync(bin)
    // O git de verdade é achado pelo próprio bash (command -v), no formato que ele entende, em qualquer sistema.
    const real = bash('command -v git').out.trim()
    writeFileSync(
      join(bin, 'git'),
      `#!/usr/bin/env bash\ncase "$*" in *--git-common-dir*) if [ "$2" = "${posix(wt)}" ]; then echo "$GIT_COMUM"; exit 0; fi;; esac\nexec "${real}" "$@"\n`,
    )
    chmodSync(join(bin, 'git'), 0o755)
    const env = { PATH: `${bin}${delimiter}${process.env.PATH}` }
    const roda = (comum: string) =>
      bash(`raiz_de_trabalho "${posix(wt)}/src/a.ts" "${posix(raiz)}"`, { ...env, GIT_COMUM: posix(comum) })
    expect(roda(apelido)).toEqual({ status: 0, out: posix(wt) })
    mkdirSync(join(base, 'outro-git'))
    expect(roda(join(base, 'outro-git')).status).toBe(1)
  })
})

// O macOS traz o bash 3.2: os hooks rodam em quem usa macOS e não podem usar construção do bash 4+ (`${x,,}` falhava lá
// e devolvia vazio). Cada padrão abaixo é do bash 4 ou posterior.
describe('hooks em bash 3.2 (macOS)', () => {
  const pasta = fileURLToPath(new URL('../.claude/hooks/', import.meta.url))
  const proibidos: [string, RegExp][] = [
    ['${x,,} ${x^^} ${x,} ${x^}', /\$\{[A-Za-z_0-9]+(,,|\^\^|,|\^)\}/],
    ['declare -A / local -A', /\b(declare|local|typeset) -[a-zA-Z]*A/],
    ['mapfile / readarray', /\b(mapfile|readarray)\b/],
    ['|& e &>>', /\|&|&>>/],
    ['coproc', /\bcoproc\b/],
    ['${!x} indireta e ${x@U}', /\$\{![A-Za-z_]|\$\{[A-Za-z_0-9]+@[UuLlQ]\}/],
    ['[[ -v x ]] e printf -v', /\[\[ -v |printf -v /],
    ['case com ;& ou ;;&', /;;&|;&\s*$/m],
  ]
  for (const arquivo of readdirSync(pasta).filter((f) => f.endsWith('.sh'))) {
    it(`${arquivo} não usa construção do bash 4+`, () => {
      const codigo = readFileSync(join(pasta, arquivo), 'utf8')
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('#'))
        .join('\n')
      for (const [nome, re] of proibidos) expect(codigo, nome).not.toMatch(re)
    })
  }
})
