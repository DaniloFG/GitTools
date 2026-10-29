import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ARG_BUDGET, MAX_COMMAND_CHARS, chunkArgs, commandChars } from '../src/core/chunk'
import { runGit } from '../src/core/exec'
import { createRepo, type TestRepo } from './helpers'

/** Quantidade de arquivos do repositório grande: o caso que estourava a linha de comando. */
const FILES = 3000
/** Caminho longo (~100 caracteres) em 30 subpastas: juntos eles passam de 300 KB de argumentos. */
const pathOf = (i: number) =>
  `modulo-com-nome-comprido-${Math.floor(i / 100)}/subpasta-de-arquivos-${Math.floor(i / 100)}/arquivo-com-nome-bem-comprido-numero-${String(i).padStart(4, '0')}-revisao.txt`
const allPaths = Array.from({ length: FILES }, (_, i) => pathOf(i))
const novoPath = (i: number) => `novos/pasta-nova-com-nome-comprido-${i}/arquivo-novo-com-nome-longo-${i}.txt`

describe('divisão de argumentos em lotes', () => {
  it('mantém a ordem e não perde nenhum item', () => {
    const items = Array.from({ length: 500 }, (_, i) => `caminho/${'x'.repeat(i % 37)}/${i}`)
    const chunks = chunkArgs(items, 400)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flat()).toEqual(items)
  })

  it('cada lote cabe no orçamento, exceto um item sozinho maior que ele', () => {
    const items = [...allPaths, 'x'.repeat(ARG_BUDGET + 500), 'curto']
    for (const chunk of chunkArgs(items)) {
      if (chunk.length > 1) expect(commandChars(chunk)).toBeLessThanOrEqual(ARG_BUDGET)
    }
    expect(chunkArgs(items).flat()).toEqual(items)
  })

  it('lista vazia não gera nenhum lote', () => {
    expect(chunkArgs([])).toEqual([])
  })

  it('recusa comando grande demais antes de iniciar o git, com mensagem clara', async () => {
    const t = await createRepo()
    const huge = Array.from({ length: 40 }, (_, i) => `${i}-${'x'.repeat(1000)}`)
    expect(commandChars(huge)).toBeGreaterThan(MAX_COMMAND_CHARS)
    await expect(runGit(t.dir, ['status', '--', ...huge])).rejects.toThrow('grande demais')
  })
})

/**
 * O cherry-pick ordena os commits pela data: commits feitos no mesmo segundo ficariam sem ordem.
 * Por isso cada commit do teste recebe uma data própria (a variável é limpa depois de cada teste).
 */
function datarCommit(n: number) {
  process.env.GIT_AUTHOR_DATE = process.env.GIT_COMMITTER_DATE = `${1_700_000_000 + n} +0000`
}
afterEach(() => {
  delete process.env.GIT_AUTHOR_DATE
  delete process.env.GIT_COMMITTER_DATE
})

/**
 * Repositório com 3 000 arquivos. A branch `feature` altera 1 500 deles, remove 150 e adiciona 300
 * novos, e depois adiciona um arquivo de ~3 MB. A `main` ganha um arquivo próprio, para divergir.
 */
async function bigRepo(): Promise<{ t: TestRepo; c1: string; c2: string; c3: string }> {
  const t = await createRepo()
  const base: Record<string, string> = {}
  allPaths.forEach((p, i) => (base[p] = `linha original ${i}\n`))
  datarCommit(1)
  await t.commit('base', base)
  await t.git('checkout', '-q', '-b', 'feature')
  const changed: Record<string, string> = {}
  for (let i = 0; i < 1500; i++) changed[pathOf(i)] = `linha original ${i}\nlinha nova ${i}\n`
  datarCommit(2)
  const c1 = await t.commit('altera 1500 arquivos', changed)
  for (let i = 1500; i < 1650; i++) rmSync(join(t.dir, pathOf(i)))
  const added: Record<string, string> = {}
  for (let i = 0; i < 300; i++) added[novoPath(i)] = `novo ${i}\n`
  datarCommit(3)
  const c2 = await t.commit('remove 150 e adiciona 300', added)
  const big = Array.from({ length: 60_000 }, (_, i) => `linha ${i} do arquivo grande com texto de preenchimento`).join('\n') + '\n'
  datarCommit(4)
  const c3 = await t.commit('arquivo grande', { 'grande/dados.txt': big })
  await t.git('checkout', '-q', 'main')
  datarCommit(5)
  await t.commit('main', { 'outro.txt': 'só no main\n' })
  return { t, c1, c2, c3 }
}

const everyPath = () => [...allPaths, ...Array.from({ length: 300 }, (_, i) => novoPath(i)), 'grande/dados.txt']

describe('cherry-pick de arquivos com milhares de caminhos', () => {
  it('modo "changes" aplica os patches de todos os caminhos (com patch de ~3 MB)', async () => {
    const { t, c1, c2, c3 } = await bigRepo()
    const result = await t.repo.cherryPickFiles('main', [c1, c2, c3], everyPath(), 'changes')
    expect(result.ok).toBe(true)
    // Depois do cherry-pick, o índice só difere do feature no arquivo que só a main tem.
    expect(await t.git('diff', '--cached', '--name-only', 'feature')).toBe('outro.txt\n')
    expect(readFileSync(join(t.dir, 'grande/dados.txt'), 'utf8')).toBe(
      Array.from({ length: 60_000 }, (_, i) => `linha ${i} do arquivo grande com texto de preenchimento`).join('\n') + '\n'
    )
    expect(existsSync(join(t.dir, pathOf(1500)))).toBe(false)
  }, 60_000)

  it('filesChangedBy junta os arquivos de vários commits (1 951 caminhos)', async () => {
    const { t, c1, c2, c3 } = await bigRepo()
    const files = await t.repo.filesChangedBy([c1, c2, c3])
    // 1 500 alterados, 150 removidos, 300 novos e o arquivo grande.
    expect(files.length).toBe(1500 + 150 + 300 + 1)
    expect(files.filter((f) => f.status === 'D').length).toBe(150)
  }, 60_000)

  it('modo "version" copia a versão mais nova e remove os que sumiram', async () => {
    const { t, c1, c2, c3 } = await bigRepo()
    const result = await t.repo.cherryPickFiles('main', [c1, c2, c3], everyPath(), 'version')
    expect(result.ok).toBe(true)
    expect(await t.git('diff', '--cached', '--name-only', 'feature')).toBe('outro.txt\n')
    expect(readFileSync(join(t.dir, pathOf(7)), 'utf8')).toBe(`linha original 7\nlinha nova 7\n`)
  }, 60_000)

  it('conflitos em muitos arquivos: abortar volta todos ao HEAD', async () => {
    const t = await createRepo()
    const base: Record<string, string> = {}
    allPaths.slice(0, 1200).forEach((p) => (base[p] = 'base\n'))
    await t.commit('base', base)
    await t.git('checkout', '-q', '-b', 'feature')
    const mudados: Record<string, string> = {}
    allPaths.slice(0, 1200).forEach((p) => (mudados[p] = 'feature\n'))
    const c = await t.commit('feature', mudados)
    await t.git('checkout', '-q', 'main')
    const outros: Record<string, string> = {}
    allPaths.slice(0, 1200).forEach((p) => (outros[p] = 'main\n'))
    await t.commit('main', outros)
    const result = await t.repo.cherryPickFiles('main', [c], allPaths.slice(0, 1200), 'changes')
    expect(result.ok).toBe(false)
    expect(result.conflicts.length).toBe(1200)
    await t.repo.abortOperation()
    expect((await t.repo.status()).conflicted).toEqual([])
    expect(readFileSync(join(t.dir, pathOf(3)), 'utf8')).toBe('main\n')
  }, 60_000)
})

describe('operações de área de trabalho com milhares de arquivos', () => {
  it('stage, unstage e discard valem para todos os caminhos', async () => {
    const { t } = await bigRepo()
    // Estado da main: volta a ter só os arquivos do base mais o outro.
    for (const p of allPaths) t.write(p, 'mudado\n')
    let status = await t.repo.status()
    expect(new Set(status.unstaged.map((f) => f.path)).size).toBe(FILES)

    await t.repo.stageFiles(allPaths)
    status = await t.repo.status()
    expect(status.staged.length).toBe(FILES)
    expect(status.unstaged.length).toBe(0)

    await t.repo.unstageFiles(allPaths)
    status = await t.repo.status()
    expect(status.staged.length).toBe(0)
    expect(status.unstaged.length).toBe(FILES)

    await t.repo.discardFiles(allPaths)
    expect((await t.repo.status()).unstaged.length).toBe(0)
    expect(readFileSync(join(t.dir, pathOf(0)), 'utf8')).toBe('linha original 0\n')
  }, 60_000)

  it('arquivos novos (não rastreados) são preparados, desfeitos e descartados em lote', async () => {
    const t = await createRepo()
    await t.commit('base', { 'a.txt': 'a\n' })
    const novos = Array.from({ length: 1000 }, (_, i) => novoPath(i))
    for (const p of novos) t.write(p, `novo\n`)
    await t.repo.stageFiles(novos)
    expect((await t.repo.status()).staged.length).toBe(1000)
    await t.repo.unstageFiles(novos)
    const depois = await t.repo.status()
    expect(depois.staged.length).toBe(0)
    expect(depois.unstaged.filter((f) => f.untracked).length).toBe(1000)
    await t.repo.discardFiles(novos)
    expect((await t.repo.status()).unstaged.length).toBe(0)
    expect(existsSync(join(t.dir, novos[0]))).toBe(false)
  }, 60_000)

  it('sem nenhum commit, unstage usa o índice e não perde arquivos', async () => {
    const t = await createRepo()
    for (const p of allPaths) t.write(p, 'x\n')
    await t.repo.stageFiles(allPaths)
    expect((await t.repo.status()).staged.length).toBe(FILES)
    await t.repo.unstageFiles(allPaths)
    expect((await t.repo.status()).staged.length).toBe(0)
  }, 60_000)

  it('status com estatísticas e diff da área de trabalho listam todos os arquivos', async () => {
    const { t } = await bigRepo()
    for (const p of allPaths) t.write(p, 'mudado\n')
    const status = await t.repo.status(true)
    expect(status.unstaged.length).toBe(FILES)
    expect(status.unstaged.every((f) => f.additions !== undefined)).toBe(true)
    const diffs = await t.repo.diff({ kind: 'unstaged' })
    expect(diffs.length).toBe(FILES)
  }, 60_000)

  it('diff de um commit com arquivo de ~3 MB não é truncado', async () => {
    const { t, c3 } = await bigRepo()
    const [file] = await t.repo.diff({ kind: 'commit', sha: c3 })
    expect(file.path).toBe('grande/dados.txt')
    expect(file.additions).toBe(60_000)
  }, 60_000)
})

describe('cherry-pick de muitos commits', () => {
  /** Cria `count` commits encadeados em `branch` (partindo da main), um arquivo cada, num só processo do git. */
  async function manyCommits(t: TestRepo, branch: string, count: number): Promise<void> {
    const parts: string[] = []
    for (let i = 1; i <= count; i++) {
      const msg = `commit ${i}\n`
      const content = `conteudo ${i}\n`
      parts.push(`commit refs/heads/${branch}\nmark :${i}\n`)
      parts.push(`committer Teste <test@example.com> ${1_700_000_000 + i} +0000\n`)
      parts.push(`data ${Buffer.byteLength(msg)}\n${msg}`)
      parts.push(i === 1 ? 'from refs/heads/main\n' : `from :${i - 1}\n`)
      parts.push(`M 100644 inline lote/item-${i}.txt\ndata ${Buffer.byteLength(content)}\n${content}\n`)
    }
    await runGit(t.dir, ['fast-import', '--quiet'], { input: parts.join('') })
  }

  it('cherryPickCommits com 800 shas (acima do limite da linha de comando) mantém a ordem', async () => {
    const t = await createRepo()
    await t.commit('base', { 'a.txt': 'a\n' })
    await manyCommits(t, 'lote', 800)
    const shas = (await t.git('rev-list', '--reverse', 'main..lote')).trim().split('\n')
    expect(shas.length).toBe(800)
    const result = await t.repo.cherryPickCommits('main', shas)
    expect(result.ok).toBe(true)
    const subjects = (await t.git('log', '--reverse', '--format=%s', 'main')).trim().split('\n')
    expect(subjects.slice(1)).toEqual(Array.from({ length: 800 }, (_, i) => `commit ${i + 1}`))
    expect((await t.repo.status()).staged.length).toBe(0)
  }, 120_000)

  it('cherryPickBranch leva a branch inteira, mesmo com 800 commits', async () => {
    const t = await createRepo()
    await t.commit('base', { 'a.txt': 'a\n' })
    await manyCommits(t, 'lote', 800)
    await t.git('branch', 'destino', 'main')
    const result = await t.repo.cherryPickBranch('lote', 'destino')
    expect(result.ok).toBe(true)
    expect((await t.repo.status()).branch).toBe('destino')
    expect((await t.git('rev-list', '--count', 'destino')).trim()).toBe('801')
    expect(readFileSync(join(t.dir, 'lote/item-800.txt'), 'utf8')).toBe('conteudo 800\n')
  }, 120_000)
})
