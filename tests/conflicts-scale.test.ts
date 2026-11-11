import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { onGitCommand } from '../src/core/exec'
import { createRepo, type TestRepo } from './helpers'
import { scale } from './support/scale'

// Auditoria (issue #61): cada cenário afirma o comportamento correto do git e da ferramenta.
// Se a ferramenta tiver bug, o teste reprova; a correção não é feita aqui.

const LONG = 120_000
const NAMED = 'pasta açúcar/arquivo com espaço.txt'
const SIZES: [string, number][] = [
  ['médio', scale(40, 40)],
  ['grande', scale(1500, 300)]
]

const outDirs: string[] = []
afterEach(() => {
  while (outDirs.length) rmSync(outDirs.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

const read = (t: TestRepo, path: string) => readFileSync(join(t.dir, path), 'utf8')
const cfiles = (n: number, prefix: string) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`src/c${i}.txt`, `${prefix} ${i}\n`]))
const conflictedPaths = async (t: TestRepo) => (await t.repo.status()).conflicted.map((f) => f.path)
const stashCount = async (t: TestRepo) => (await t.git('stash', 'list')).split('\n').filter(Boolean).length

/** Árvore limpa: nada em conflito, no índice ou alterado na pasta de trabalho. */
async function expectClean(t: TestRepo) {
  const s = await t.repo.status()
  expect(s.conflicted.map((f) => f.path)).toEqual([])
  expect(s.staged).toEqual([])
  expect(s.unstaged).toEqual([])
}

/** Conflito de conteúdo em `paths`: base "base i", main "main i", feature "feature i". HEAD é main. */
async function contentConflict(paths: string[]): Promise<TestRepo> {
  const t = await createRepo()
  const texts = (prefix: string) => Object.fromEntries(paths.map((p, i) => [p, `${prefix} ${i}\n`]))
  await t.commit('base', texts('base'))
  await t.git('checkout', '-q', '-b', 'feature')
  await t.commit('feature', texts('feature'))
  await t.git('checkout', '-q', 'main')
  await t.commit('main', texts('main'))
  expect((await t.repo.merge('feature', 'main')).ok).toBe(false)
  return t
}

/**
 * Repositório com os tipos mistos de conflito, mais N arquivos de texto em conflito.
 * Feature tem 3 commits (o primeiro traz os tipos mistos; os outros só repetem os textos), para o cherry-pick e o rebase.
 */
async function mixedRepo(n: number): Promise<TestRepo> {
  const t = await createRepo()
  await t.commit('base', {
    ...cfiles(n, 'base'),
    'modrem.txt': 'base\n',
    'remmod.txt': 'base\n',
    'bin.dat': '\0base\n',
    [NAMED]: 'base\n',
    'renomeado.txt': 'linha 1\nlinha 2\nlinha 3\n'
  })
  await t.git('checkout', '-q', '-b', 'feature')
  rmSync(join(t.dir, 'modrem.txt'))
  rmSync(join(t.dir, 'renomeado.txt'))
  await t.commit('feature 1', {
    ...cfiles(n, 'feature 1'),
    'remmod.txt': 'feature mod\n',
    'addadd.txt': 'feature add\n',
    [NAMED]: 'feature\n',
    'bin.dat': '\0feature\n',
    'renomeado-novo.txt': 'linha 1\nfeature\nlinha 3\n'
  })
  await t.commit('feature 2', cfiles(n, 'feature 2'))
  await t.commit('feature 3', cfiles(n, 'feature 3'))
  await t.git('checkout', '-q', 'main')
  rmSync(join(t.dir, 'remmod.txt'))
  await t.commit('main muda', {
    ...cfiles(n, 'main'),
    'modrem.txt': 'main mod\n',
    'addadd.txt': 'main add\n',
    [NAMED]: 'main\n',
    'bin.dat': '\0main\n',
    'renomeado.txt': 'linha 1\nmain\nlinha 3\n'
  })
  return t
}

/** Estado esperado após aceitar "theirs" em todo o repositório misto (vale para merge, cherry-pick e rebase). */
function expectTheirsState(t: TestRepo, n: number) {
  expect(read(t, `src/c${n - 1}.txt`)).toBe(`feature 3 ${n - 1}\n`)
  expect(read(t, 'remmod.txt')).toBe('feature mod\n')
  expect(read(t, 'addadd.txt')).toBe('feature add\n')
  expect(read(t, NAMED)).toBe('feature\n')
  expect(read(t, 'bin.dat')).toBe('\0feature\n')
  expect(read(t, 'renomeado-novo.txt')).toContain('feature')
  // O lado que entra removeu modrem.txt: some do disco e do índice.
  expect(existsSync(join(t.dir, 'modrem.txt'))).toBe(false)
}

/** Estado esperado após aceitar "ours" (HEAD = main). */
function expectOursState(t: TestRepo, n: number) {
  expect(read(t, `src/c${n - 1}.txt`)).toBe(`main ${n - 1}\n`)
  expect(read(t, 'modrem.txt')).toBe('main mod\n')
  expect(existsSync(join(t.dir, 'remmod.txt'))).toBe(false)
  expect(read(t, 'addadd.txt')).toBe('main add\n')
  expect(read(t, NAMED)).toBe('main\n')
  expect(read(t, 'bin.dat')).toBe('\0main\n')
  expect(read(t, 'renomeado-novo.txt')).toContain('main')
}

/** Resolve tudo com "theirs" e continua até a operação terminar. Cada passo tem de resolver e continuar sem erro. */
async function finishWithTheirs(t: TestRepo) {
  for (let step = 0; step < 10; step++) {
    if ((await t.repo.operationState()).kind === 'none') return step
    const conflicted = await conflictedPaths(t)
    if (conflicted.length) {
      const resolved = await t.repo.resolveConflicts(conflicted, 'theirs')
      expect(resolved).toEqual({ resolved: conflicted.length, failed: [] })
    }
    const cont = await t.repo.continueOperation()
    expect(cont.ok).toBe(true)
  }
  throw new Error('a operação não terminou em 10 passos')
}

// ----------------------------------------------------------------- 1. merge com tipos mistos

describe.each(SIZES)('1. merge com conflitos mistos (%s)', (_, n) => {
  it('"ours" em lote, depois continueOperation: commit de merge, árvore limpa, lado HEAD', async () => {
    const t = await mixedRepo(n)
    const merged = await t.repo.merge('feature', 'main')
    expect(merged.ok).toBe(false)
    const paths = await conflictedPaths(t)
    expect(paths).toContain('modrem.txt')
    expect(paths).toContain('remmod.txt')
    expect(paths).toContain('addadd.txt')
    expect(paths).toContain(NAMED)
    expect(paths).toContain('bin.dat')
    expect(paths.length).toBeGreaterThanOrEqual(n + 5)

    expect(await t.repo.resolveConflicts(paths, 'ours')).toEqual({ resolved: paths.length, failed: [] })
    const cont = await t.repo.continueOperation()
    expect(cont.ok).toBe(true)
    expect((await t.git('rev-list', '--parents', '-n', '1', 'HEAD')).trim().split(' ')).toHaveLength(3)
    expect((await t.repo.operationState()).kind).toBe('none')
    await expectClean(t)
    expectOursState(t, n)
  }, LONG)

  it('"theirs" em lote, depois continueOperation: arquivos que o outro lado removeu somem do índice e do disco', async () => {
    const t = await mixedRepo(n)
    expect((await t.repo.merge('feature', 'main')).ok).toBe(false)
    const paths = await conflictedPaths(t)
    expect(await t.repo.resolveConflicts(paths, 'theirs')).toEqual({ resolved: paths.length, failed: [] })
    expect((await t.repo.continueOperation()).ok).toBe(true)
    expect((await t.repo.operationState()).kind).toBe('none')
    await expectClean(t)
    expectTheirsState(t, n)
    expect((await t.git('ls-files', 'modrem.txt')).trim()).toBe('')
  }, LONG)
})

// ------------------------------------------------------ 2. cherry-pick e rebase com conflitos repetidos

describe.each(['cherry-pick', 'rebase'] as const)('2. %s com conflitos em vários commits', (kind) => {
  const n = scale(40, 40)
  /** Inicia a operação sobre a feature (3 commits que conflitam) e devolve o HEAD inicial e o resultado. */
  async function start(t: TestRepo) {
    // O rebase leva HEAD para a feature (que estava em main ao começar): o sha inicial é o da feature.
    const before = (await t.git('rev-parse', kind === 'cherry-pick' ? 'HEAD' : 'feature')).trim()
    const result = kind === 'cherry-pick' ? await t.repo.cherryPickBranch('feature', 'main') : await t.repo.rebase('feature', 'main')
    return { before, result }
  }

  it('"theirs" repetido até operationState none: estado final é o da feature', async () => {
    const t = await mixedRepo(n)
    const { result } = await start(t)
    expect(result.ok).toBe(false)
    await finishWithTheirs(t)
    expect((await t.repo.operationState()).kind).toBe('none')
    await expectClean(t)
    expectTheirsState(t, n)
  }, LONG)

  it('skipOperation até o fim: HEAD volta ao sha inicial e a árvore fica limpa', async () => {
    const t = await mixedRepo(n)
    const { before, result } = await start(t)
    expect(result.ok).toBe(false)
    // O próximo commit também conflita: o skip devolve ok false com os conflitos, e o laço segue até o fim.
    for (let step = 0; step < 10 && (await t.repo.operationState()).kind !== 'none'; step++) {
      await t.repo.skipOperation()
    }
    expect((await t.repo.operationState()).kind).toBe('none')
    // Pular todos os commits do cherry-pick deixa HEAD onde estava; pular todos do rebase põe a feature na base (main).
    const expected = kind === 'cherry-pick' ? before : (await t.git('rev-parse', 'main')).trim()
    expect((await t.git('rev-parse', 'HEAD')).trim()).toBe(expected)
    await expectClean(t)
  }, LONG)

  it('abortOperation no primeiro conflito: HEAD igual ao sha inicial, sem conflitos', async () => {
    const t = await mixedRepo(n)
    const { before, result } = await start(t)
    expect(result.ok).toBe(false)
    await t.repo.abortOperation()
    expect((await t.repo.operationState()).kind).toBe('none')
    expect((await t.git('rev-parse', 'HEAD')).trim()).toBe(before)
    await expectClean(t)
    // Conteúdo do commit de origem (main no cherry-pick, a feature original no rebase).
    expect(read(t, `src/c${n - 1}.txt`)).toBe(await t.git('show', `${before}:src/c${n - 1}.txt`))
  }, LONG)
})

describe('2. rebase abortado volta à feature', () => {
  it('abortOperation: HEAD volta à feature (branch que o rebase checou), no sha inicial dela', async () => {
    const t = await mixedRepo(scale(40, 40))
    const featureBefore = (await t.git('rev-parse', 'feature')).trim()
    expect((await t.git('symbolic-ref', '--short', 'HEAD')).trim()).toBe('main')
    expect((await t.repo.rebase('feature', 'main')).ok).toBe(false)
    await t.repo.abortOperation()
    // `git rebase main feature` faz checkout de feature; o abort volta a ela, não à branch em que o usuário estava (main).
    expect((await t.git('symbolic-ref', '--short', 'HEAD')).trim()).toBe('feature')
    expect((await t.git('rev-parse', 'HEAD')).trim()).toBe(featureBefore)
  }, LONG)
})

// -------------------------------------------------------- 3. revert e stash pop com conflito em N arquivos

describe('3. revert e stash pop com conflito em lote', () => {
  const n = scale(40, 40)

  it('revertCommit: "theirs" em lote e continueOperation criam o commit de reversão', async () => {
    const t = await createRepo()
    await t.commit('base', cfiles(n, 'base'))
    const changed = await t.commit('muda', cfiles(n, 'changed'))
    await t.commit('depois', cfiles(n, 'later'))
    const reverted = await t.repo.revertCommit(changed)
    expect(reverted.ok).toBe(false)
    expect(reverted.conflicts).toHaveLength(n)
    expect(await t.repo.resolveConflicts(reverted.conflicts, 'theirs')).toEqual({ resolved: n, failed: [] })
    expect((await t.repo.continueOperation()).ok).toBe(true)
    expect((await t.repo.operationState()).kind).toBe('none')
    await expectClean(t)
    expect(read(t, 'src/c0.txt')).toBe('base 0\n')
    expect((await t.git('rev-list', '--parents', '-n', '1', 'HEAD')).trim().split(' ')).toHaveLength(2)
  }, LONG)

  it('stashApply(pop) com conflito: o stash fica na lista; após resolver, continua lá (git não derruba sozinho)', async () => {
    const t = await createRepo()
    await t.commit('base', cfiles(n, 'base'))
    for (let i = 0; i < n; i++) t.write(`src/c${i}.txt`, `stash ${i}\n`)
    await t.git('stash', 'push', '-q')
    await t.commit('depois', cfiles(n, 'head'))
    expect(await stashCount(t)).toBe(1)

    const popped = await t.repo.stashApply(0, true)
    expect(popped.ok).toBe(false)
    expect(popped.conflicts).toHaveLength(n)
    // O git mantém a entrada do stash quando o pop termina com conflito.
    expect(await stashCount(t)).toBe(1)

    expect(await t.repo.resolveConflicts(popped.conflicts, 'theirs')).toEqual({ resolved: n, failed: [] })
    expect(read(t, 'src/c0.txt')).toBe('stash 0\n')
    expect((await t.repo.operationState()).kind).toBe('none')
    expect(await stashCount(t)).toBe(1)
  }, LONG)
})

// ---------------------------------------------------------- 4. "resolved" em lote

describe('4. resolveConflicts "resolved" em lote', () => {
  it('editado sem marcadores resolve; com marcadores falha; modificado×removido apagado no disco é removido', async () => {
    const n = scale(40, 40)
    const t = await mixedRepo(n)
    expect((await t.repo.merge('feature', 'main')).ok).toBe(false)
    const paths = await conflictedPaths(t)
    for (const p of paths) {
      if (p === 'src/c0.txt') continue // fica com os marcadores do git
      if (p === 'modrem.txt') rmSync(join(t.dir, p)) // modificado×removido: apagar no disco é resolver
      else t.write(p, 'editado\n')
    }
    const result = await t.repo.resolveConflicts(paths, 'resolved')
    expect(result.resolved).toBe(paths.length - 1)
    expect(result.failed).toEqual([{ path: 'src/c0.txt', message: 'Ainda tem marcadores de conflito' }])
    expect(await conflictedPaths(t)).toEqual(['src/c0.txt'])
    expect((await t.git('ls-files', 'modrem.txt')).trim()).toBe('')
    // Com um conflito restante, o continue recusa.
    await expect(t.repo.continueOperation()).rejects.toThrow()

    expect(await t.repo.resolveConflicts(['src/c0.txt'], 'theirs')).toEqual({ resolved: 1, failed: [] })
    expect((await t.repo.continueOperation()).ok).toBe(true)
    expect((await t.repo.operationState()).kind).toBe('none')
    expect((await t.git('rev-list', '--parents', '-n', '1', 'HEAD')).trim().split(' ')).toHaveLength(3)
    await expectClean(t)
  }, LONG)
})

// --------------------------------------------------- 5. caminhos duplicados e iniciados por '-'

describe('5. caminhos duplicados e iniciados por "-"', () => {
  it('lista com duplicados e "-rf.txt" em conflito: conta cada arquivo uma vez e não lê como opção', async () => {
    const t = await contentConflict(['-rf.txt', 'c.txt'])
    expect(await conflictedPaths(t)).toEqual(['-rf.txt', 'c.txt'])
    const result = await t.repo.resolveConflicts(['-rf.txt', '-rf.txt', 'c.txt', 'c.txt'], 'ours')
    expect(result).toEqual({ resolved: 2, failed: [] })
    expect(read(t, '-rf.txt')).toBe('main 0\n')
    await expectClean(t)
  }, LONG)

  it('"-rf.txt" editado sem marcadores resolve com "resolved"', async () => {
    const t = await contentConflict(['-rf.txt'])
    t.write('-rf.txt', 'editado\n')
    expect(await t.repo.resolveConflicts(['-rf.txt', '-rf.txt'], 'resolved')).toEqual({ resolved: 1, failed: [] })
    // Resolvido vai para o índice (staged): o merge ainda não foi commitado, então só conferimos o conflito.
    expect(await conflictedPaths(t)).toEqual([])
    expect(read(t, '-rf.txt')).toBe('editado\n')
  }, LONG)
})

// ------------------------------------------------------------- 6. segurança: caminho fora do repositório

describe('6. caminho fora do repositório no editor de conflitos', () => {
  async function setup() {
    const t = await contentConflict(['x.txt'])
    const outDir = mkdtempSync(join(tmpdir(), 'gittools-out-'))
    outDirs.push(outDir)
    const outside = join(outDir, 'fora.txt')
    writeFileSync(outside, 'SEGREDO FORA\n')
    return { t, outside, rel: relative(t.dir, outside) }
  }

  it('conflictDetails com "../" não devolve o conteúdo de arquivo fora do repositório', async () => {
    const { t, rel } = await setup()
    await expect(t.repo.conflictDetails(rel)).rejects.toThrow()
  }, LONG)

  it('conflictDetails com caminho absoluto não devolve o conteúdo fora do repositório', async () => {
    const { t, outside } = await setup()
    await expect(t.repo.conflictDetails(outside)).rejects.toThrow()
  }, LONG)

  it('conflictDetails não lê o arquivo de trabalho acima do teto do editor (2 MB)', async () => {
    const t = await contentConflict(['x.txt'])
    writeFileSync(join(t.dir, 'x.txt'), 'a'.repeat(2 * 1024 * 1024 + 1))
    const details = await t.repo.conflictDetails('x.txt')
    expect(details.working).toBeNull()
    expect(details.ours).toBe('main 0\n')
  }, LONG)

  it('saveConflictResolution com "../" ou caminho absoluto não grava fora do repositório', async () => {
    const { t, outside, rel } = await setup()
    await expect(t.repo.saveConflictResolution(rel, 'PWNED\n')).rejects.toThrow()
    await expect(t.repo.saveConflictResolution(outside, 'PWNED\n')).rejects.toThrow()
    expect(readFileSync(outside, 'utf8')).toBe('SEGREDO FORA\n')
  }, LONG)
})

// ----------------------------------------- 7. abortOperation após conflito de cherryPickFiles (git apply --3way)

describe('7. abortOperation após conflito de cherryPickFiles', () => {
  it('caracteriza o abort atual: só o arquivo em conflito volta ao HEAD (limitação conhecida)', async () => {
    const t = await createRepo()
    await t.commit('base', { 'a.txt': 'base\n', 'b.txt': 'base\n' })
    await t.git('checkout', '-q', '-b', 'feature')
    const sha = await t.commit('feature', { 'a.txt': 'feature\n', 'b.txt': 'feature\n', 'novo.txt': 'novo\n' })
    await t.git('checkout', '-q', 'main')
    const mainSha = await t.commit('main', { 'a.txt': 'main\n' })

    const applied = await t.repo.cherryPickFiles('main', [sha], ['a.txt', 'b.txt', 'novo.txt'], 'changes')
    expect(applied.ok).toBe(false)
    expect(applied.conflicts).toEqual(['a.txt'])

    await t.repo.abortOperation()
    expect((await t.git('rev-parse', 'HEAD')).trim()).toBe(mainSha)
    // Limitação: o abort faz checkout HEAD só dos caminhos em conflito (repository.ts, abortOperation).
    // b.txt, aplicado sem conflito, e novo.txt, criado pelo patch, continuam no índice depois do abort.
    // Isto é o comportamento atual, não o correto: descartar o índice inteiro poderia apagar trabalho do usuário.
    expect(read(t, 'a.txt')).toBe('main\n')
    expect(read(t, 'b.txt')).toBe('feature\n')
    expect(read(t, 'novo.txt')).toBe('novo\n')
    expect((await t.repo.status()).staged.map((f) => f.path).sort()).toEqual(['b.txt', 'novo.txt'])
  }, LONG)
})

// ------------------------------------------------------------ 8. processos git da resolução em lote

describe('8. processos git de resolveConflicts', () => {
  it('"ours" em lote grande fica dentro do orçamento de processos', async () => {
    const n = scale(1500, 300)
    const paths = Array.from({ length: n }, (_, i) => `src/f${i}.txt`)
    const t = await contentConflict(paths)
    const conflicted = await conflictedPaths(t)
    expect(conflicted).toHaveLength(n)

    const started: string[][] = []
    const stop = onGitCommand((entry) => {
      if (entry.exitCode === undefined) started.push(entry.args)
    })
    let result
    try {
      result = await t.repo.resolveConflicts(conflicted, 'ours')
    } finally {
      stop()
    }
    const limit = 2 + 2 * Math.ceil(n / 100) + 6
    console.log(`resolveConflicts(${n} arquivos, 'ours'): ${started.length} processos git (limite ${limit})`)
    expect(result).toEqual({ resolved: n, failed: [] })
    expect(started.length).toBeLessThanOrEqual(limit)
  }, LONG)
})
