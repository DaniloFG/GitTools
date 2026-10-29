import { afterEach, describe, expect, it } from 'vitest'
import { runGit, onGitCommand } from '../src/core/exec'
import { runTerminalCommand, TERMINAL_MAX_OUTPUT } from '../src/core/terminal'
import { BRIDGE_CHANNELS } from '../src/shared/channels'
import { parseCommandLine, validateGitCommand } from '../src/shared/terminal'
import { createRepo, type TestRepo } from './helpers'
import type { GitCommandEntry } from '../src/shared/types'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const repos: TestRepo[] = []
afterEach(() => {
  repos.length = 0
})

async function repo(): Promise<TestRepo> {
  const r = await createRepo()
  repos.push(r)
  await r.commit('primeiro', { 'a.txt': 'a\n' })
  return r
}

describe('parseCommandLine', () => {
  it('separa palavras e respeita aspas simples e duplas', () => {
    expect(parseCommandLine('git commit -m "Olá mundo"')).toEqual({ ok: true, tokens: ['git', 'commit', '-m', 'Olá mundo'] })
    expect(parseCommandLine("git log --grep='a  b'")).toEqual({ ok: true, tokens: ['git', 'log', '--grep=a  b'] })
    // Aspas coladas na palavra formam uma só: --grep=  + "x" + y
    expect(parseCommandLine('git log --grep="x"y')).toEqual({ ok: true, tokens: ['git', 'log', '--grep=xy'] })
  })

  it('trata escapes com barra invertida e aspas vazias', () => {
    expect(parseCommandLine('git log a\\ b')).toEqual({ ok: true, tokens: ['git', 'log', 'a b'] })
    expect(parseCommandLine('echo "a\\"b\\\\c"')).toEqual({ ok: true, tokens: ['echo', 'a"b\\c'] })
    expect(parseCommandLine("git commit -m ''")).toEqual({ ok: true, tokens: ['git', 'commit', '-m', ''] })
  })

  it('não expande variáveis, curingas nem til', () => {
    expect(parseCommandLine('git grep $HOME *.ts ~')).toEqual({ ok: true, tokens: ['git', 'grep', '$HOME', '*.ts', '~'] })
  })

  it('recusa pipes, redirecionamentos, encadeamento e aspas abertas', () => {
    for (const line of ['git log | head', 'git status && git log', 'git log > saida.txt', 'git status; rm -rf x', 'git commit -m "sem fim']) {
      const parsed = parseCommandLine(line)
      expect(parsed.ok, line).toBe(false)
    }
  })
})

describe('validateGitCommand', () => {
  it('aceita com ou sem a palavra "git" e devolve os argumentos', () => {
    expect(validateGitCommand('git status -s')).toMatchObject({ ok: true, args: ['status', '-s'], subcommand: 'status' })
    expect(validateGitCommand('log --oneline')).toMatchObject({ ok: true, args: ['log', '--oneline'], subcommand: 'log' })
  })

  it('recusa linhas vazias e comandos que não são do git', () => {
    expect(validateGitCommand('   ')).toMatchObject({ ok: false })
    expect(validateGitCommand('git')).toMatchObject({ ok: false })
    expect(validateGitCommand('ls -la')).toMatchObject({ ok: true, subcommand: 'ls' }) // o git responde que não existe
    expect(validateGitCommand('/usr/bin/git status')).toMatchObject({ ok: false })
    expect(validateGitCommand('rm -rf .')).toMatchObject({ ok: true }) // "rm" vira subcomando do git: o git recusa
  })

  it('recusa opções que executam programas ou trocam a pasta', () => {
    expect(validateGitCommand('git -c core.pager=less log')).toMatchObject({ ok: false })
    expect(validateGitCommand('git -c core.sshCommand=evil fetch')).toMatchObject({ ok: false })
    expect(validateGitCommand('git -c filter.x.clean=evil status')).toMatchObject({ ok: false })
    expect(validateGitCommand('git -c alias.x=!rm status')).toMatchObject({ ok: false })
    expect(validateGitCommand('git --exec-path=/tmp status')).toMatchObject({ ok: false })
    expect(validateGitCommand('git ls-remote --upload-pack=evil origin')).toMatchObject({ ok: false })
    expect(validateGitCommand('git -C /tmp status')).toMatchObject({ ok: false })
    expect(validateGitCommand('git --git-dir=/x status')).toMatchObject({ ok: false })
    expect(validateGitCommand('git -c user.name=Fulano status')).toMatchObject({ ok: true, args: ['-c', 'user.name=Fulano', 'status'] })
  })

  it('recusa gravar configurações que apontam para programas, mas deixa ler', () => {
    expect(validateGitCommand('git config core.sshCommand evil')).toMatchObject({ ok: false })
    expect(validateGitCommand('git config alias.x "!rm -rf ."')).toMatchObject({ ok: false })
    expect(validateGitCommand('git config --get core.pager')).toMatchObject({ ok: true })
    expect(validateGitCommand('git config user.name Fulano')).toMatchObject({ ok: true })
  })

  it('recusa comandos interativos e explica a alternativa', () => {
    const rebase = validateGitCommand('git rebase -i HEAD~3')
    expect(rebase.ok).toBe(false)
    expect(!rebase.ok && rebase.error).toContain('rebase -i')
    expect(validateGitCommand('git rebase --interactive main')).toMatchObject({ ok: false })
    expect(validateGitCommand('git add -p')).toMatchObject({ ok: false })
    expect(validateGitCommand('git add -A')).toMatchObject({ ok: true })
    expect(validateGitCommand('git checkout -p')).toMatchObject({ ok: false })
    expect(validateGitCommand('git mergetool')).toMatchObject({ ok: false })
    expect(validateGitCommand('git stash -p')).toMatchObject({ ok: false })
    expect(validateGitCommand('git stash show -p')).toMatchObject({ ok: true })
    expect(validateGitCommand('git log -p')).toMatchObject({ ok: true })
  })

  it('recusa commit e tag que abririam o editor, mas aceita com mensagem', () => {
    expect(validateGitCommand('git commit')).toMatchObject({ ok: false })
    expect(validateGitCommand('git commit -m "Corrige o login"')).toMatchObject({ ok: true })
    expect(validateGitCommand('git commit -am "Ajusta"')).toMatchObject({ ok: true })
    expect(validateGitCommand('git commit --amend --no-edit')).toMatchObject({ ok: true })
    expect(validateGitCommand('git commit --fixup=abc123')).toMatchObject({ ok: true })
    expect(validateGitCommand('git commit --fixup=amend:abc123')).toMatchObject({ ok: false })
    expect(validateGitCommand('git tag -a v1')).toMatchObject({ ok: false })
    expect(validateGitCommand('git tag -a v1 -m "Versão 1"')).toMatchObject({ ok: true })
    expect(validateGitCommand('git tag -d v1')).toMatchObject({ ok: true })
  })
})

describe('runTerminalCommand (repositório real)', () => {
  it('executa um comando de leitura e devolve a saída', async () => {
    const r = await repo()
    const result = await runTerminalCommand(r.dir, 'git log --format=%s')
    expect(result).toMatchObject({ ok: true, exitCode: 0, args: ['log', '--format=%s'] })
    expect(result.stdout.trim()).toBe('primeiro')
  })

  it('devolve stderr e código de saída quando o git falha', async () => {
    const r = await repo()
    const result = await runTerminalCommand(r.dir, 'git rev-parse --verify nao-existe')
    expect(result.ok).toBe(false)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.length).toBeGreaterThan(0)
  })

  it('recusa sem executar: o log não recebe nenhum comando', async () => {
    const r = await repo()
    const seen: GitCommandEntry[] = []
    const stop = onGitCommand((e) => seen.push(e))
    try {
      const result = await runTerminalCommand(r.dir, 'git commit')
      expect(result.ok).toBe(false)
      expect(result.stderr).toContain('editor')
      expect(seen).toHaveLength(0)
    } finally {
      stop()
    }
  })

  it('o comando executado aparece no log de comandos', async () => {
    const r = await repo()
    const seen: GitCommandEntry[] = []
    const stop = onGitCommand((e) => seen.push(e))
    try {
      await runTerminalCommand(r.dir, 'git status -s')
      const started = seen.find((e) => e.args.join(' ') === 'status -s' && e.exitCode === undefined)
      const finished = seen.find((e) => e.args.join(' ') === 'status -s' && e.exitCode === 0)
      expect(started).toBeDefined()
      expect(finished).toBeDefined()
    } finally {
      stop()
    }
  })

  it('recusa alias que começa com "!" (executa shell)', async () => {
    const r = await repo()
    await r.git('config', 'alias.oi', '!echo oi')
    const result = await runTerminalCommand(r.dir, 'git oi')
    expect(result.ok).toBe(false)
    expect(result.stderr).toContain('"oi"')
  })

  it('corta a saída acima do limite e avisa', async () => {
    const r = await repo()
    const big = 'x'.repeat(1024)
    // Um arquivo de ~2,5 MB: o `git show` precisa de mais que o limite do terminal.
    writeFileSync(join(r.dir, 'grande.txt'), Array.from({ length: 2600 }, () => big).join('\n'))
    await r.git('add', '-A')
    await r.git('commit', '-q', '-m', 'grande')
    const result = await runTerminalCommand(r.dir, 'git show HEAD:grande.txt')
    expect(result.ok).toBe(true)
    expect(result.stdout.length).toBeLessThanOrEqual(TERMINAL_MAX_OUTPUT + 200)
    expect(result.stdout).toContain('cortada')
  })

  it('runGit aceita limite de saída sem alterar o resultado normal', async () => {
    const r = await repo()
    const res = await runGit(r.dir, ['log', '--format=%s'], { maxOutputBytes: 1000 })
    expect(res.truncated).toBeFalsy()
    expect(res.stdout.trim()).toBe('primeiro')
  })

  it('o terminal é registrado no canal da ponte', () => {
    expect(BRIDGE_CHANNELS).toContain('app:runGit')
  })
})
