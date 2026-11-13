import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// lib-raiz.sh (#199): formato único de caminho dos hooks. No Windows o git devolve "C:/..." e o Git Bash "/c/...", e o
// mesmo diretório tem grafia curta (8.3) e longa; aqui isso é simulado com funções puras e com link simbólico.
const lib = fileURLToPath(new URL('../.claude/hooks/lib-raiz.sh', import.meta.url))

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
    base = realpathSync(mkdtempSync(join(tmpdir(), 'gittools-libraiz-')))
    raiz = join(base, 'repo')
    mkdirSync(join(raiz, '.claude'), { recursive: true })
  })
  afterEach(() => rmSync(base, { recursive: true, force: true }))

  it('aceita só issue.local e triagem.local dentro do .claude da raiz', () => {
    const ok = (p: string) => bash(`marcador_da_raiz "${p}" "${raiz}"`).status === 0
    expect(ok(`${raiz}/.claude/issue.local`)).toBe(true)
    expect(ok(`${raiz}/.claude/triagem.local`)).toBe(true)
    expect(ok(`${raiz}/.claude/outro.local`)).toBe(false)
    expect(ok(`${raiz}/src/issue.local`)).toBe(false)
    expect(ok(`${base}/outro/.claude/issue.local`)).toBe(false)
  })

  it('reconhece o mesmo .claude por outra grafia (link), mas não um .claude de outra pasta', () => {
    symlinkSync(join(raiz, '.claude'), join(base, 'apelido'))
    mkdirSync(join(base, 'outro', '.claude'), { recursive: true })
    mkdirSync(join(base, 'alias'))
    symlinkSync(join(raiz, '.claude'), join(base, 'alias', '.claude'))
    expect(bash(`marcador_da_raiz "${base}/alias/.claude/issue.local" "${raiz}"`).status).toBe(0)
    expect(bash(`marcador_da_raiz "${base}/outro/.claude/issue.local" "${raiz}"`).status).toBe(1)
  })

  it('raiz_de_trabalho: git que diz a mesma pasta de outra grafia é o mesmo repositório; pasta diferente não', () => {
    const git = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: raiz })
    git('init', '-q')
    git('commit', '-q', '--allow-empty', '-m', 'b')
    const wt = join(base, 'wt')
    expect(git('worktree', 'add', '-q', '-b', 'x', wt).status).toBe(0)
    // git de mentira: a pasta comum do worktree sai por um link (outra grafia do mesmo diretório).
    const apelido = join(base, 'apelido-git')
    symlinkSync(join(raiz, '.git'), apelido)
    const bin = join(base, 'bin')
    mkdirSync(bin)
    const real = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim()
    writeFileSync(
      join(bin, 'git'),
      `#!/usr/bin/env bash\ncase "$*" in *--git-common-dir*) if [ "$2" = "${wt}" ]; then echo "$GIT_COMUM"; exit 0; fi;; esac\nexec "${real}" "$@"\n`,
    )
    chmodSync(join(bin, 'git'), 0o755)
    const env = { PATH: `${bin}:${process.env.PATH}` }
    const roda = (comum: string) => bash(`raiz_de_trabalho "${wt}/src/a.ts" "${raiz}"`, { ...env, GIT_COMUM: comum })
    expect(roda(apelido)).toEqual({ status: 0, out: wt })
    mkdirSync(join(base, 'outro-git'))
    expect(roda(join(base, 'outro-git')).status).toBe(1)
  })
})
