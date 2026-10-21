import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { changeKeys } from '../src/core/diff'
import { createRepo, lines } from './helpers'

const BASE = lines('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j')

describe('status, branches e log', () => {
  it('lista arquivos staged, unstaged, não rastreados e a branch atual', async () => {
    const t = await createRepo()
    await t.commit('init', { 'a.txt': BASE, 'b.txt': 'b\n' })
    t.write('a.txt', BASE + 'k\n')
    t.write('b.txt', 'B\n')
    await t.git('add', 'b.txt')
    t.write('novo arquivo.txt', 'x\n')

    const s = await t.repo.status()
    expect(s.branch).toBe('main')
    expect(s.staged.map((f) => f.path)).toEqual(['b.txt'])
    expect(s.unstaged.map((f) => f.path).sort()).toEqual(['a.txt', 'novo arquivo.txt'])
    expect(s.unstaged.find((f) => f.untracked)?.path).toBe('novo arquivo.txt')
  })

  it('lista branches e histórico com refs', async () => {
    const t = await createRepo()
    const first = await t.commit('primeiro', { 'a.txt': 'a\n' })
    await t.git('checkout', '-q', '-b', 'feature')
    await t.commit('segundo', { 'a.txt': 'b\n' })
    const branches = await t.repo.branches()
    expect(branches.map((b) => [b.name, b.current])).toEqual([
      ['feature', true],
      ['main', false]
    ])
    const log = await t.repo.log({ all: true })
    expect(log.map((c) => c.subject)).toEqual(['segundo', 'primeiro'])
    expect(log[1].sha).toBe(first)
    expect(log[0].refs).toContain('HEAD -> feature')
    const details = await t.repo.commitDetails(log[0].sha)
    expect(details.files).toEqual([{ status: 'M', path: 'a.txt', additions: 1, deletions: 1 }])
  })
})

describe('stage/unstage/descartar por linha', () => {
  it('adiciona ao stage apenas as linhas escolhidas', async () => {
    const t = await createRepo()
    await t.commit('init', { 'f.txt': BASE })
    t.write('f.txt', BASE.replace('b\n', 'B\n').replace('i\n', 'I\n'))

    const [file] = await t.repo.diff({ kind: 'unstaged', path: 'f.txt' })
    // Só a primeira alteração (b -> B): as duas primeiras linhas alteradas.
    const firstChange = changeKeys(file).slice(0, 2)
    await t.repo.applyLines({ kind: 'unstaged' }, 'f.txt', firstChange, 'stage')

    expect(await t.git('show', ':f.txt')).toBe(BASE.replace('b\n', 'B\n'))
    expect(readFileSync(join(t.dir, 'f.txt'), 'utf8')).toBe(BASE.replace('b\n', 'B\n').replace('i\n', 'I\n'))

    // Desfaz o stage da mesma linha.
    const [staged] = await t.repo.diff({ kind: 'staged', path: 'f.txt' })
    await t.repo.applyLines({ kind: 'staged' }, 'f.txt', changeKeys(staged), 'unstage')
    expect(await t.git('show', ':f.txt')).toBe(BASE)
  })

  it('faz stage parcial de um arquivo não rastreado', async () => {
    const t = await createRepo()
    await t.commit('init', { 'f.txt': 'x\n' })
    t.write('novo.txt', lines('1', '2', '3'))
    const [file] = await t.repo.diff({ kind: 'unstaged', path: 'novo.txt' })
    expect(file.changeType).toBe('added')
    await t.repo.applyLines({ kind: 'unstaged' }, 'novo.txt', ['0:0', '0:2'], 'stage')
    expect(await t.git('show', ':novo.txt')).toBe(lines('1', '3'))
  })

  it('descarta só as linhas escolhidas da árvore de trabalho', async () => {
    const t = await createRepo()
    await t.commit('init', { 'f.txt': BASE })
    t.write('f.txt', BASE.replace('a\n', 'A\n').replace('j\n', 'J\n'))
    const [file] = await t.repo.diff({ kind: 'unstaged', path: 'f.txt' })
    const keys = changeKeys(file)
    await t.repo.applyLines({ kind: 'unstaged' }, 'f.txt', keys.slice(-2), 'discard')
    expect(readFileSync(join(t.dir, 'f.txt'), 'utf8')).toBe(BASE.replace('a\n', 'A\n'))
  })
})

/** main: init; feature: 3 commits mexendo em arquivos diferentes. */
async function branchScenario() {
  const t = await createRepo()
  await t.commit('init', { 'app.txt': BASE, 'lib.txt': 'lib\n' })
  await t.git('checkout', '-q', '-b', 'feature')
  const c1 = await t.commit('altera app', { 'app.txt': BASE.replace('b\n', 'B\n').replace('h\n', 'H\n') })
  const c2 = await t.commit('altera lib', { 'lib.txt': 'lib v2\n' })
  const c3 = await t.commit('novo arquivo', { 'extra.txt': 'extra\n' })
  await t.git('checkout', '-q', 'main')
  await t.commit('main segue', { 'outro.txt': 'outro\n' })
  return { t, c1, c2, c3 }
}

describe('cherry-pick', () => {
  it('lista os commits da branch que faltam no destino, marcando os já aplicados', async () => {
    const { t, c2 } = await branchScenario()
    await t.git('cherry-pick', c2)
    const commits = await t.repo.branchCommits('feature', 'main')
    expect(commits.map((c) => [c.subject, c.alreadyApplied])).toEqual([
      ['novo arquivo', false],
      ['altera lib', true],
      ['altera app', false]
    ])
  })

  it('aplica a branch inteira, pulando o que já existe', async () => {
    const { t, c2 } = await branchScenario()
    await t.git('cherry-pick', c2)
    const result = await t.repo.cherryPickBranch('feature', 'main', { recordOrigin: true })
    expect(result.ok).toBe(true)
    const log = await t.repo.log({ ref: 'main' })
    expect(log.slice(0, 4).map((c) => c.subject)).toEqual(['novo arquivo', 'altera app', 'altera lib', 'main segue'])
    expect(await t.git('log', '-1', '--format=%B')).toContain('cherry picked from commit')
  })

  it('aplica commits escolhidos na ordem correta e muda para a branch de destino', async () => {
    const { t, c1, c3 } = await branchScenario()
    await t.git('checkout', '-q', 'feature')
    const result = await t.repo.cherryPickCommits('main', [c3, c1])
    expect(result.ok).toBe(true)
    expect((await t.repo.status()).branch).toBe('main')
    const log = await t.repo.log({ ref: 'main', limit: 2 })
    expect(log.map((c) => c.subject)).toEqual(['novo arquivo', 'altera app'])
  })

  it('aplica apenas arquivos escolhidos de commits', async () => {
    const { t, c1, c2 } = await branchScenario()
    const result = await t.repo.cherryPickFiles('main', [c1, c2], ['lib.txt'], 'changes', { commitMessage: 'só lib' })
    expect(result.ok).toBe(true)
    expect(readFileSync(join(t.dir, 'lib.txt'), 'utf8')).toBe('lib v2\n')
    expect(readFileSync(join(t.dir, 'app.txt'), 'utf8')).toBe(BASE)
    expect((await t.repo.log({ limit: 1 }))[0].subject).toBe('só lib')
  })

  it('copia a versão final de um arquivo', async () => {
    const { t, c3 } = await branchScenario()
    const result = await t.repo.cherryPickFiles('main', [c3], ['extra.txt'], 'version')
    expect(result.ok).toBe(true)
    expect((await t.repo.status()).staged.map((f) => f.path)).toEqual(['extra.txt'])
  })

  it('aplica só algumas linhas de um commit em outra branch', async () => {
    const { t, c1 } = await branchScenario()
    // main também mudou app.txt longe das linhas alteradas, para exigir aplicação com contexto deslocado.
    await t.commit('main mexe no app', { 'app.txt': 'topo\n' + BASE })
    const [file] = await t.repo.diff({ kind: 'commit', sha: c1, path: 'app.txt' })
    const keys = changeKeys(file)
    expect(keys).toHaveLength(4)
    // Só a segunda alteração (h -> H).
    const result = await t.repo.cherryPickLines('main', { kind: 'commit', sha: c1 }, 'app.txt', keys.slice(2), {
      commitMessage: 'só o H'
    })
    expect(result.ok).toBe(true)
    expect(readFileSync(join(t.dir, 'app.txt'), 'utf8')).toBe('topo\n' + BASE.replace('h\n', 'H\n'))
  })

  it('aplica linhas de um intervalo (diferença acumulada da branch)', async () => {
    const { t } = await branchScenario()
    const base = (await t.git('merge-base', 'main', 'feature')).trim()
    const files = await t.repo.diff({ kind: 'range', from: base, to: 'feature' })
    expect(files.map((f) => f.path).sort()).toEqual(['app.txt', 'extra.txt', 'lib.txt'])
    const result = await t.repo.cherryPickLines('main', { kind: 'range', from: base, to: 'feature' }, 'extra.txt', ['0:0'])
    expect(result.ok).toBe(true)
    expect(existsSync(join(t.dir, 'extra.txt'))).toBe(true)
  })

  it('relata conflitos e permite resolver e continuar', async () => {
    const t = await createRepo()
    await t.commit('init', { 'f.txt': 'original\n' })
    await t.git('checkout', '-q', '-b', 'feature')
    const c = await t.commit('feature muda', { 'f.txt': 'feature\n' })
    await t.git('checkout', '-q', 'main')
    await t.commit('main muda', { 'f.txt': 'main\n' })

    const result = await t.repo.cherryPickCommits('main', [c])
    expect(result.ok).toBe(false)
    expect(result.conflicts).toEqual(['f.txt'])
    expect((await t.repo.operationState()).kind).toBe('cherry-pick')

    await expect(t.repo.continueOperation()).rejects.toThrow(/conflitos/)
    await t.repo.resolveConflict('f.txt', 'theirs')
    const done = await t.repo.continueOperation()
    expect(done.ok).toBe(true)
    expect((await t.repo.operationState()).kind).toBe('none')
    expect(readFileSync(join(t.dir, 'f.txt'), 'utf8')).toBe('feature\n')
  })

  it('aborta um cherry-pick em andamento', async () => {
    const t = await createRepo()
    await t.commit('init', { 'f.txt': 'original\n' })
    await t.git('checkout', '-q', '-b', 'feature')
    const c = await t.commit('feature muda', { 'f.txt': 'feature\n' })
    await t.git('checkout', '-q', 'main')
    const head = await t.commit('main muda', { 'f.txt': 'main\n' })
    await t.repo.cherryPickCommits('main', [c])
    await t.repo.abortOperation()
    expect((await t.git('rev-parse', 'HEAD')).trim()).toBe(head)
    expect((await t.repo.status()).conflicted).toEqual([])
  })
})

describe('merge, rebase e stash', () => {
  it('faz merge de uma branch em outra', async () => {
    const { t } = await branchScenario()
    const result = await t.repo.merge('feature', 'main', true)
    expect(result.ok).toBe(true)
    expect(existsSync(join(t.dir, 'extra.txt'))).toBe(true)
  })

  it('faz rebase de uma branch sobre outra', async () => {
    const { t } = await branchScenario()
    const result = await t.repo.rebase('feature', 'main')
    expect(result.ok).toBe(true)
    const log = await t.repo.log({ ref: 'feature' })
    expect(log.map((c) => c.subject)).toEqual(['novo arquivo', 'altera lib', 'altera app', 'main segue', 'init'])
  })

  it('guarda e reaplica alterações com stash', async () => {
    const t = await createRepo()
    await t.commit('init', { 'f.txt': 'a\n' })
    t.write('f.txt', 'b\n')
    t.write('novo.txt', 'n\n')
    await t.repo.stash('wip')
    expect((await t.repo.status()).unstaged).toEqual([])
    const [s] = await t.repo.stashes()
    expect(s.message).toContain('wip')
    await t.repo.stashApply(0, true)
    expect(readFileSync(join(t.dir, 'f.txt'), 'utf8')).toBe('b\n')
    expect(await t.repo.stashes()).toEqual([])
  })
})

describe('tags', () => {
  it('cria tags simples e anotadas em qualquer commit e as exclui', async () => {
    const t = await createRepo()
    const first = await t.commit('primeiro', { 'a.txt': 'a\n' })
    const second = await t.commit('segundo', { 'a.txt': 'b\n' })
    await t.repo.createTag('v1', first)
    await t.repo.createTag('v2', undefined, 'Versão 2')
    expect(await t.repo.tags()).toEqual(expect.arrayContaining([{ name: 'v1', sha: first }, { name: 'v2', sha: second }]))
    expect((await t.git('cat-file', '-t', 'v2')).trim()).toBe('tag')
    expect((await t.git('cat-file', '-t', 'v1')).trim()).toBe('commit')
    await expect(t.repo.createTag('-x')).rejects.toThrow('Nome de tag inválido')
    await t.repo.deleteTag('v1')
    expect((await t.repo.tags()).map((tag) => tag.name)).toEqual(['v2'])
  })
})
