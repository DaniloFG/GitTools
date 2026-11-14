import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { changeKeys, parseDiff } from '../src/core/diff'
import { runGit } from '../src/core/exec'
import { parseNumstat, UNTRACKED_STATS_LIMIT } from '../src/core/repository'
import { DIFF_MAX_BYTES } from '../src/shared/types'
import { createRepo, lines } from './helpers'

// Espião das leituras de conteúdo do núcleo (`readFile` de node:fs/promises): conta quantas foram e quantas
// correram ao mesmo tempo. Repassa tudo ao módulo real; só observa.
const reads = vi.hoisted(() => ({ count: 0, inFlight: 0, peak: 0 }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const readFile = (...args: unknown[]) => {
    reads.count++
    reads.inFlight++
    reads.peak = Math.max(reads.peak, reads.inFlight)
    return (actual.readFile as (...a: unknown[]) => Promise<unknown>)(...args).finally(() => {
      reads.inFlight--
    })
  }
  return { ...actual, readFile }
})

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

  it('pagina o histórico com skip: as páginas somadas são a lista inteira, sem repetir nem pular', async () => {
    const t = await createRepo()
    for (let i = 1; i <= 5; i++) await t.commit(`commit ${i}`, { 'a.txt': `${i}\n` })
    const first = await t.repo.log({ limit: 2 })
    const second = await t.repo.log({ skip: 2, limit: 2 })
    const whole = await t.repo.log({ limit: 4 })
    expect([...first, ...second].map((c) => c.sha)).toEqual(whole.map((c) => c.sha))
    expect(second.map((c) => c.subject)).toEqual(['commit 3', 'commit 2'])
    // Um deslocamento além do fim devolve lista vazia, não erro.
    expect(await t.repo.log({ skip: 50, limit: 2 })).toEqual([])
  })

  it('rejeita deslocamento negativo ou inválido antes de chamar o git', async () => {
    const t = await createRepo()
    await t.commit('init', { 'a.txt': 'a\n' })
    await expect(t.repo.log({ skip: -1 })).rejects.toThrow()
    await expect(t.repo.log({ skip: Number.NaN })).rejects.toThrow()
  })
})

describe('contagem de linhas dos arquivos novos', () => {
  /** Os arquivos novos do status, por caminho. */
  const newFiles = (status: { unstaged: { path: string; untracked: boolean }[] }) =>
    new Map(status.unstaged.filter((f) => f.untracked).map((f) => [f.path, f as { path: string; additions?: number; binary?: boolean }]))

  it('conta como antes: com e sem quebra final, vazio e binário; acima de 1 MB não conta', async () => {
    const t = await createRepo()
    await t.commit('init', { 'base.txt': 'x\n' })
    t.write('a.txt', 'um\ndois\n')
    t.write('sem-quebra.txt', 'x\ny')
    t.write('vazio.txt', '')
    t.write('bin.dat', 'ab\0cd')
    t.write('grande.txt', 'a\n'.repeat(600_000)) // 1,2 MB: acima do limite de leitura
    const files = newFiles(await t.repo.status(true))
    expect(files.get('a.txt')).toMatchObject({ additions: 2, deletions: 0 })
    expect(files.get('sem-quebra.txt')).toMatchObject({ additions: 2, deletions: 0 })
    expect(files.get('vazio.txt')).toMatchObject({ additions: 0, deletions: 0 })
    expect(files.get('bin.dat')).toEqual({ path: 'bin.dat', untracked: true, index: '?', worktree: '?', conflicted: false, binary: true })
    expect(files.get('grande.txt')?.additions).toBeUndefined()
  })

  it('o segundo status sem mudança não relê conteúdo; só o arquivo editado é relido', async () => {
    const t = await createRepo()
    await t.commit('init', { 'base.txt': 'x\n' })
    t.write('a.txt', 'um\n')
    t.write('b.txt', 'dois\n')
    reads.count = 0
    await t.repo.status(true)
    expect(reads.count).toBe(2)
    reads.count = 0
    const again = newFiles(await t.repo.status(true))
    expect(reads.count).toBe(0)
    expect(again.get('a.txt')?.additions).toBe(1)
    t.write('a.txt', 'um\ndois\ntrês\n') // o tamanho muda: esse arquivo é lido de novo
    reads.count = 0
    const edited = newFiles(await t.repo.status(true))
    expect(reads.count).toBe(1)
    expect(edited.get('a.txt')?.additions).toBe(3)
    expect(edited.get('b.txt')?.additions).toBe(1)
  })

  it('lê os arquivos novos em fila de no máximo 8 leituras ao mesmo tempo', async () => {
    const t = await createRepo()
    await t.commit('init', { 'base.txt': 'x\n' })
    for (let n = 0; n < 40; n++) t.write(`novo-${n}.txt`, `${n}\n`)
    reads.count = 0
    reads.peak = 0
    const files = newFiles(await t.repo.status(true))
    expect(reads.count).toBe(40)
    expect(reads.peak).toBeGreaterThan(1)
    expect(reads.peak).toBeLessThanOrEqual(8)
    expect(files.get('novo-7.txt')?.additions).toBe(1)
  })

  it('conta só até o teto de arquivos novos; os demais ficam sem contagem', async () => {
    const t = await createRepo()
    await t.commit('init', { 'base.txt': 'x\n' })
    const total = UNTRACKED_STATS_LIMIT + 5
    for (let n = 0; n < total; n++) t.write(`pasta/${String(n).padStart(4, '0')}.txt`, 'a\n')
    reads.count = 0
    const files = [...newFiles(await t.repo.status(true)).values()]
    expect(files).toHaveLength(total)
    expect(files.filter((f) => f.additions === 1)).toHaveLength(UNTRACKED_STATS_LIMIT)
    expect(files.filter((f) => f.additions === undefined)).toHaveLength(5)
    expect(reads.count).toBe(UNTRACKED_STATS_LIMIT)
  })

  it('o cache guarda só os arquivos novos atuais: um arquivo que deixou de ser novo sai dele', async () => {
    const t = await createRepo()
    await t.commit('init', { 'base.txt': 'x\n' })
    t.write('a.txt', 'um\n')
    t.write('b.txt', 'dois\n')
    await t.repo.status(true)
    const cache = (t.repo as unknown as { untrackedCache: Map<string, unknown> }).untrackedCache
    expect([...cache.keys()].sort()).toEqual(['a.txt', 'b.txt'])
    await t.git('add', 'a.txt') // sai da lista de não rastreados
    await t.repo.status(true)
    expect([...cache.keys()]).toEqual(['b.txt'])
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

describe('refs: branches e tags num único comando', () => {
  it('devolve o mesmo que branches() e tags(), na mesma ordem', async () => {
    const t = await createRepo()
    const first = await t.commit('um', { 'a.txt': '1\n' })
    await t.git('branch', 'feature/x')
    await t.git('tag', 'leve')
    await t.commit('dois', { 'a.txt': '2\n' })
    await t.git('tag', '-a', 'anotada', '-m', 'versão anotada')
    await t.git('tag', 'v0', first)
    const refs = await t.repo.refs()
    expect(refs.branches).toEqual(await t.repo.branches())
    expect(refs.tags).toEqual(await t.repo.tags())
    expect(refs.tags.map((tag) => tag.name).sort()).toEqual(['anotada', 'leve', 'v0'])
    // A tag anotada aponta para o commit (não para o objeto da tag).
    expect(refs.tags.find((tag) => tag.name === 'anotada')!.sha).toBe((await t.git('rev-parse', 'HEAD')).trim())
  })

  it('funciona num repositório sem commits', async () => {
    const t = await createRepo()
    expect(await t.repo.refs()).toEqual({ branches: [], tags: [] })
  })
})

describe('reescrever a mensagem do HEAD', () => {
  it('troca a mensagem, mantém a árvore e não inclui o que está em stage', async () => {
    const t = await createRepo()
    await t.commit('init', { 'a.txt': 'a\n' })
    const head = await t.commit('errada', { 'b.txt': 'b\n' })
    t.write('c.txt', 'c\n')
    await t.git('add', 'c.txt')

    await t.repo.rewordHead('certa\n\ncorpo da mensagem')

    expect((await t.git('log', '-1', '--format=%B')).trim()).toBe('certa\n\ncorpo da mensagem')
    // A árvore do commit continua a mesma (sem c.txt) e o arquivo em stage segue em stage.
    expect((await t.git('ls-tree', '--name-only', 'HEAD')).split('\n').filter(Boolean).sort()).toEqual(['a.txt', 'b.txt'])
    expect((await t.git('diff', '--cached', '--name-only')).trim()).toBe('c.txt')
    expect((await t.git('rev-parse', 'HEAD')).trim()).not.toBe(head)
  })

  it('recusa mensagem vazia', async () => {
    const t = await createRepo()
    await t.commit('init', { 'a.txt': 'a\n' })
    await expect(t.repo.rewordHead('   ')).rejects.toThrow()
  })
})

/** 120.000 linhas de 40 bytes (4,8 MB, acima do teto). Com `changed`, cada 8ª linha vira uma alteração isolada. */
function bigText(changed: boolean): string {
  let out = ''
  for (let i = 0; i < 120_000; i++) out += (changed && i % 8 === 0 ? 'y' : 'x') + String(i).padStart(38, '0') + '\n'
  return out
}

describe('diff com teto de tamanho', () => {
  it('corta o diff de arquivos rastreados no teto, mas mantém os arquivos antes do corte', async () => {
    const t = await createRepo()
    await t.commit('init', { 'a.txt': 'a\n', 'big.txt': bigText(false) })
    t.write('a.txt', 'A\n')
    t.write('big.txt', bigText(true))

    const files = await t.repo.diff({ kind: 'unstaged' })
    expect(files.map((f) => f.path)).toEqual(['a.txt', 'big.txt'])
    expect(files[0].truncated).toBeUndefined()
    const big = files[1]
    expect(big.truncated).toBe(true)
    // 15.000 blocos no total; o corte deixa uns 12 mil. Cada bloco tem um "+" e um "-".
    expect(big.hunks.length).toBeGreaterThan(1_000)
    expect(big.hunks.length).toBeLessThan(15_000)
    expect(big.additions).toBe(big.hunks.length)
    expect(big.deletions).toBe(big.hunks.length)
  })

  it('stage de linha do último bloco, que some na leitura com teto, funciona', async () => {
    const t = await createRepo()
    await t.commit('init', { 'big.txt': bigText(false) })
    t.write('big.txt', bigText(true))

    // Com teto, o último bloco não aparece; sem teto, aparece e pode ser escolhido.
    const [capped] = await t.repo.diff({ kind: 'unstaged', path: 'big.txt' })
    const [full] = await t.repo.diff({ kind: 'unstaged', path: 'big.txt', uncapped: true })
    const lastHunk = full.hunks.length - 1
    expect(capped.hunks.some((_, h) => h === lastHunk)).toBe(false)
    // Último bloco: a linha removida e a adicionada (119992 é a última alteração).
    const keys = changeKeys(full).slice(-2)
    expect(keys.every((k) => k.startsWith(`${lastHunk}:`))).toBe(true)

    await t.repo.applyLines({ kind: 'unstaged' }, 'big.txt', keys, 'stage')
    const staged = (await t.git('show', ':big.txt')).split('\n')
    expect(staged[119992]).toBe('y' + String(119992).padStart(38, '0'))
  })

  it('"mostrar mesmo assim" (uncapped) devolve o diff inteiro, sem marca de corte', async () => {
    const t = await createRepo()
    await t.commit('init', { 'big.txt': bigText(false) })
    t.write('big.txt', bigText(true))

    const [file] = await t.repo.diff({ kind: 'unstaged', path: 'big.txt', uncapped: true })
    expect(file.truncated).toBeUndefined()
    expect(file.hunks).toHaveLength(15_000)
    expect(file.additions).toBe(15_000)
  })

  it('arquivo não rastreado maior que o teto é lido só até o teto, cortado numa quebra de linha', async () => {
    const t = await createRepo()
    await t.commit('init', { 'f.txt': 'x\n' })
    t.write('novo.txt', bigText(false))

    const [file] = await t.repo.diff({ kind: 'unstaged', path: 'novo.txt' })
    expect(file.binary).toBe(false)
    expect(file.truncated).toBe(true)
    const lines = file.hunks[0].lines
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.length).toBeLessThan(120_000)
    expect(file.additions).toBe(lines.length)
    // A última linha vem inteira: o corte caiu depois de uma quebra de linha.
    expect(lines[lines.length - 1].content).toBe('x' + String(lines.length - 1).padStart(38, '0'))
    expect(lines.reduce((bytes, l) => bytes + l.content.length + 1, 0)).toBeLessThanOrEqual(DIFF_MAX_BYTES)
  })

  it('arquivo não rastreado maior que o teto sai inteiro com "mostrar mesmo assim"', async () => {
    const t = await createRepo()
    await t.commit('init', { 'f.txt': 'x\n' })
    t.write('novo.txt', bigText(false))

    const [file] = await t.repo.diff({ kind: 'unstaged', path: 'novo.txt', uncapped: true })
    expect(file.truncated).toBeUndefined()
    expect(file.hunks[0].lines).toHaveLength(120_000)
  })
})

/** Árvore vazia do repositório de teste (o git grava o objeto na primeira vez). */
async function emptyTree(dir: string): Promise<string> {
  return (await runGit(dir, ['hash-object', '-t', 'tree', '--stdin'], { input: '' })).stdout.trim()
}

/**
 * Caminho anterior de `commitDetails`, só para comparar: `git show -s` para o cabeçalho e `name-status` mais
 * `numstat` contra o primeiro pai (ou a árvore vazia, no commit raiz).
 */
async function legacyDetails(dir: string, sha: string) {
  const header = (
    await runGit(dir, ['show', '-s', '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%D%x1f%cn%x1f%b', sha, '--'])
  ).stdout
  const fields = header.split('\x1f')
  const parents = fields[1] ? fields[1].split(' ') : []
  const base = parents[0] ?? (await emptyTree(dir))
  const names = (await runGit(dir, ['diff', '--name-status', '-z', '-M', '--no-color', base, sha, '--'])).stdout
  const numstat = (await runGit(dir, ['diff', '--numstat', '-z', '-M', '--no-color', '--no-ext-diff', base, sha, '--'])).stdout
  const parts = names.split('\0').filter((p) => p !== '')
  const files: { status: string; path: string; oldPath?: string }[] = []
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i][0]
    if (status === 'R' || status === 'C') {
      files.push({ status, oldPath: parts[i + 1], path: parts[i + 2] })
      i += 2
    } else {
      files.push({ status, path: parts[i + 1] })
      i += 1
    }
  }
  const stats = parseNumstat(numstat)
  return {
    committer: fields[7],
    body: (fields[8] ?? '').trim(),
    files: files.map((f) => ({ ...f, ...stats.get(f.path) }))
  }
}

/** Diff de um commit pelo caminho anterior: `rev-list` para achar o pai, depois `git diff` com as mesmas opções. */
async function legacyCommitDiff(dir: string, sha: string, path?: string) {
  const parents = (await runGit(dir, ['rev-list', '--parents', '-n1', sha, '--'])).stdout.trim().split(' ')
  const base = parents[1] ?? (await emptyTree(dir))
  const args = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--full-index', '--src-prefix=a/', '--dst-prefix=b/', '-U3', '-M', base, sha]
  args.push('--', ...(path ? [path] : []))
  return parseDiff((await runGit(dir, args)).stdout)
}

describe('commitDetails e diff de commit: iguais ao caminho anterior', () => {
  it('commitDetails cobre raiz, vários arquivos, renomeação, binário, vazio, merge e mensagem difícil', async () => {
    // Windows não aceita ':' no nome do arquivo; o nome com '-' também não pode ser lido como opção do git.
    const estranho = process.platform === 'win32' ? '-estranho.txt' : ':estranho.txt'
    const t = await createRepo()
    const shas: string[] = []
    shas.push(
      await t.commit('raiz', {
        'com espaço é.txt': 'a\nb\nc\n',
        'old.txt': lines('1', '2', '3', '4', '5', '6', '7', '8', '9', '10'),
        'bin.dat': 'bin\0x',
        [estranho]: 'e\n',
        '1 dígito.txt': 'd\n'
      })
    )
    shas.push(
      await t.commit('título: "x" \\ & ç\n\nlinha 2\n\n  recuo\nSigned-off-by: X <x@y>', {
        'com espaço é.txt': 'a\nB\nc\n',
        'novo.txt': 'n\n',
        [estranho]: 'e2\n'
      })
    )
    await t.git('mv', 'old.txt', 'renomeado ç.txt')
    t.write('renomeado ç.txt', lines('1', '2', '3', 'CINCO', '5', '6', '7', '8', '9', '10'))
    await t.git('add', '-A')
    await t.git('commit', '-q', '-m', 'renomeia com mudança')
    shas.push((await t.git('rev-parse', 'HEAD')).trim())
    await t.git('mv', 'bin.dat', 'bin2.dat')
    await t.git('commit', '-q', '-m', 'renomeia sem mudança')
    shas.push((await t.git('rev-parse', 'HEAD')).trim())
    t.write('bin2.dat', 'outro\0bin')
    shas.push(await t.commit('binário mudou', {}))
    await t.git('commit', '-q', '--allow-empty', '-m', 'vazio')
    shas.push((await t.git('rev-parse', 'HEAD')).trim())
    await t.git('checkout', '-q', '-b', 'feat')
    shas.push(await t.commit('feat', { 'feat.txt': 'f\n' }))
    await t.git('checkout', '-q', 'main')
    await t.commit('main', { 'm.txt': 'm\n' })
    await t.git('merge', '-q', '--no-edit', 'feat')
    shas.push((await t.git('rev-parse', 'HEAD')).trim())

    for (const sha of shas) {
      const details = await t.repo.commitDetails(sha)
      const legacy = await legacyDetails(t.dir, sha)
      expect({ files: details.files, body: details.body, committer: details.committer }).toEqual(legacy)
    }

    // Valores escritos à mão para os casos que mais importam.
    // shas[6] é o commit do feature (não é o merge): fica de fora da desestruturação.
    const [root, multi, rename, pureRename, binary, empty, , merge] = await Promise.all(shas.map((s) => t.repo.commitDetails(s)))
    expect(root.parents).toEqual([])
    expect(root.files.map((f) => f.path)).toContain('com espaço é.txt')
    expect(multi.subject).toBe('título: "x" \\ & ç')
    expect(multi.body).toBe('linha 2\n\n  recuo\nSigned-off-by: X <x@y>')
    expect(multi.files).toEqual(
      expect.arrayContaining([
        { status: 'M', path: 'com espaço é.txt', additions: 1, deletions: 1 },
        { status: 'A', path: 'novo.txt', additions: 1, deletions: 0 },
        { status: 'M', path: estranho, additions: 1, deletions: 1 }
      ])
    )
    expect(rename.files).toEqual([{ status: 'R', oldPath: 'old.txt', path: 'renomeado ç.txt', additions: 1, deletions: 1 }])
    // bin.dat tem NUL, então é binário: a renomeação sem mudança não tem contagem de linhas.
    expect(pureRename.files).toEqual([{ status: 'R', oldPath: 'bin.dat', path: 'bin2.dat', binary: true }])
    expect(binary.files).toEqual([{ status: 'M', path: 'bin2.dat', binary: true }])
    expect(empty.files).toEqual([])
    expect(merge.parents).toHaveLength(2)
    expect(merge.files).toEqual([{ status: 'A', path: 'feat.txt', additions: 1, deletions: 0 }])
  })

  it('diff de commit (normal, merge, raiz e com caminho) sai igual ao caminho anterior', async () => {
    const t = await createRepo()
    const root = await t.commit('raiz', { 'a.txt': lines('a', 'b', 'c'), 'sp ace.txt': 'x\n' })
    const second = await t.commit('segundo', { 'a.txt': lines('a', 'B', 'c'), 'sp ace.txt': 'y\n' })
    await t.git('checkout', '-q', '-b', 'feat')
    await t.commit('feat', { 'feat.txt': 'f\n' })
    await t.git('checkout', '-q', 'main')
    await t.commit('main', { 'm.txt': 'm\n' })
    await t.git('merge', '-q', '--no-edit', 'feat')
    const merge = (await t.git('rev-parse', 'HEAD')).trim()

    for (const sha of [root, second, merge]) {
      expect(await t.repo.diff({ kind: 'commit', sha })).toEqual(await legacyCommitDiff(t.dir, sha))
    }
    expect(await t.repo.diff({ kind: 'commit', sha: second, path: 'sp ace.txt' })).toEqual(
      await legacyCommitDiff(t.dir, second, 'sp ace.txt')
    )
    // O merge mostra só o que o feature trouxe (contra o primeiro pai, a main).
    const [mergeFile] = await t.repo.diff({ kind: 'commit', sha: merge })
    expect(mergeFile.path).toBe('feat.txt')
  })

  it('diff de commit com caminho e oldPath acha a renomeação com uma linha mudada', async () => {
    const t = await createRepo()
    await t.commit('base', { 'a.txt': BASE, 'c.txt': 'c\n' })
    await t.git('mv', 'a.txt', 'b.txt')
    t.write('b.txt', lines('a', 'b', 'c', 'd', 'E', 'f', 'g', 'h', 'i', 'j'))
    await t.git('add', '-A')
    await t.git('commit', '-q', '-m', 'renomeia com mudança')
    const sha = (await t.git('rev-parse', 'HEAD')).trim()

    // Com o caminho antigo no pathspec, o git acha a renomeação e a comparação sai como R, +1 −1.
    const [renamed] = await t.repo.diff({ kind: 'commit', sha, path: 'b.txt', oldPath: 'a.txt' })
    expect(renamed).toMatchObject({ changeType: 'renamed', oldPath: 'a.txt', newPath: 'b.txt', path: 'b.txt', additions: 1, deletions: 1 })

    // Sem -M (unstaged) o oldPath fica de fora: se entrasse, o c.txt alterado na pasta de trabalho apareceria aqui.
    t.write('b.txt', lines('a', 'b', 'c', 'd', 'E', 'f', 'g', 'h', 'i', 'K'))
    t.write('c.txt', 'c2\n')
    const semOldPath = await t.repo.diff({ kind: 'unstaged', path: 'b.txt' })
    expect(semOldPath.map((f) => f.path)).toEqual(['b.txt'])
    expect(await t.repo.diff({ kind: 'unstaged', path: 'b.txt', oldPath: 'c.txt' })).toEqual(semOldPath)
  })
  it('renomeação com uma linha mudada sai +1 −1 no staged, no range e no histórico de arquivo (#161)', async () => {
    const t = await createRepo()
    await t.commit('base', { 'a.txt': BASE, 'c.txt': 'c\n' })
    const base = (await t.git('rev-parse', 'HEAD')).trim()
    await t.git('mv', 'a.txt', 'b.txt')
    t.write('b.txt', lines('a', 'b', 'c', 'd', 'E', 'f', 'g', 'h', 'i', 'j'))
    await t.git('add', '-A')

    // Staged: com o caminho antigo (origPath do status) a renomeação é achada; sem ele, o arquivo todo é adição.
    const semAntigo = await t.repo.diff({ kind: 'staged', path: 'b.txt' })
    expect(semAntigo[0]).toMatchObject({ changeType: 'added', additions: 10 })
    const [staged] = await t.repo.diff({ kind: 'staged', path: 'b.txt', oldPath: 'a.txt' })
    expect(staged).toMatchObject({ changeType: 'renamed', oldPath: 'a.txt', additions: 1, deletions: 1 })

    await t.git('commit', '-q', '-m', 'renomeia')
    const head = (await t.git('rev-parse', 'HEAD')).trim()
    const [range] = await t.repo.diff({ kind: 'range', from: base, to: head, path: 'b.txt', oldPath: 'a.txt' })
    expect(range).toMatchObject({ changeType: 'renamed', additions: 1, deletions: 1 })

    // Histórico de arquivo: só o commit da renomeação leva oldPath, e com ele o diff sai +1 −1.
    const history = await t.repo.fileHistory('b.txt')
    expect(history.map((e) => [e.path, e.oldPath])).toEqual([['b.txt', 'a.txt'], ['a.txt', undefined]])
    const [viaHistory] = await t.repo.diff({ kind: 'commit', sha: history[0].sha, path: history[0].path, oldPath: history[0].oldPath })
    expect(viaHistory).toMatchObject({ changeType: 'renamed', additions: 1, deletions: 1 })
  })
})
