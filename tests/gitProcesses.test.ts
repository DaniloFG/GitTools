import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Backend, type BackendHost } from '../src/backend/backend'
import { onGitCommand, runGit } from '../src/core/exec'
import { GitRepository } from '../src/core/repository'
import { createRepo } from './helpers'

// Estes testes contam processos git: cada comando iniciado vira um aviso sem código de saída.

/** Comandos git iniciados enquanto `fn` roda (um processo por comando). */
async function countGit<T>(fn: () => Promise<T>): Promise<{ result: T; processes: string[][] }> {
  const started: string[][] = []
  const stop = onGitCommand((entry) => {
    if (entry.exitCode === undefined) started.push(entry.args)
  })
  try {
    return { result: await fn(), processes: started }
  } finally {
    stop()
  }
}

const dirs: string[] = []
const backends: Backend[] = []
afterEach(() => {
  backends.splice(0).forEach((b) => b.dispose())
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function fakeHost(): BackendHost {
  const data = mkdtempSync(join(tmpdir(), 'gittools-data-'))
  dirs.push(data)
  const host: BackendHost = {
    dataDir: () => data,
    homeDir: () => data,
    documentsDir: () => data,
    systemLocales: () => ['pt-BR'],
    versions: () => ({ host: 'vscode', version: '1.0.0', electron: '', chrome: '', node: process.versions.node, platform: 'test' }),
    emit: () => undefined,
    pickFolder: async () => null,
    openPath: async () => undefined,
    openInEditor: async () => undefined,
    testEditor: async () => undefined,
    detectEditors: () => [],
    chooseEditor: async () => null,
    openDiffWindow: () => undefined,
    settingsChanged: () => undefined
  }
  return host
}

function newBackend(): Backend {
  const backend = new Backend(fakeHost())
  backends.push(backend)
  return backend
}

describe('GitRepository: processos git', () => {
  it('open abre exatamente 1 processo git', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    const { result, processes } = await countGit(() => GitRepository.open(t.dir))
    expect(processes).toHaveLength(1)
    expect(result.root).toBe(t.repo.root)
  })

  it('gitDir de instância criada direto descobre a pasta .git uma vez e guarda', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    const repo = new GitRepository(t.repo.root)
    const first = await countGit(() => repo.gitDir())
    expect(first.processes).toHaveLength(1)
    expect(basename(first.result)).toBe('.git')
    const second = await countGit(() => repo.gitDir())
    expect(second.processes).toHaveLength(0)
    expect(second.result).toBe(first.result)
  })

  it('a segunda chamada de operationState não abre processo e acompanha merge com conflito e aborto', async () => {
    const t = await createRepo()
    await t.commit('base', { 'a.txt': 'base\n' })
    await t.git('checkout', '-q', '-b', 'feature')
    await t.commit('feature', { 'a.txt': 'feature\n' })
    await t.git('checkout', '-q', 'main')
    await t.commit('main', { 'a.txt': 'main\n' })
    const repo = await GitRepository.open(t.dir)

    expect(await repo.operationState()).toEqual({ kind: 'none' })

    // Conflito: o git sai com código 1, que é esperado aqui.
    await runGit(t.dir, ['merge', 'feature'], { okExitCodes: [0, 1] })
    const during = await countGit(() => repo.operationState())
    expect(during.processes).toHaveLength(0)
    expect(during.result).toEqual({ kind: 'merge', head: expect.any(String) })

    await runGit(t.dir, ['merge', '--abort'])
    const after = await countGit(() => repo.operationState())
    expect(after.processes).toHaveLength(0)
    expect(after.result).toEqual({ kind: 'none' })
  })

  it('a segunda chamada de log abre exatamente 1 processo e devolve o mesmo resultado', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    await t.commit('segundo', { 'a.txt': 'b\n' })
    const repo = await GitRepository.open(t.dir)
    const first = await repo.log()
    expect(first.map((c) => c.subject)).toEqual(['segundo', 'primeiro'])

    const second = await countGit(() => repo.log())
    expect(second.processes).toHaveLength(1)
    expect(second.result).toEqual(first)
  })

  it('repositório sem commits: log e log({ all: true }) devolvem []', async () => {
    const t = await createRepo()
    expect(await t.repo.log()).toEqual([])
    expect(await t.repo.log({ all: true })).toEqual([])
    // Segunda rodada, já sem a lembrança do HEAD: a resposta não muda.
    expect(await t.repo.log()).toEqual([])
    expect(await t.repo.log({ all: true })).toEqual([])
  })

  it('branch órfã depois de commits: log devolve [] e log({ all: true }) devolve os commits das outras branches', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    await t.commit('segundo', { 'a.txt': 'b\n' })
    await t.git('checkout', '-q', '--orphan', 'novo')

    const fresh = await GitRepository.open(t.dir)
    expect(await fresh.log()).toEqual([])
    expect((await fresh.log({ all: true })).map((c) => c.subject)).toEqual(['segundo', 'primeiro'])
  })

  it('HEAD que virou órfão depois de já ter sido visto: log cai no caminho completo e devolve []', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    await t.commit('segundo', { 'a.txt': 'b\n' })
    const repo = await GitRepository.open(t.dir)
    // Lembra que o HEAD existe.
    expect((await repo.log()).map((c) => c.subject)).toEqual(['segundo', 'primeiro'])

    await t.git('checkout', '-q', '--orphan', 'novo')
    expect(await repo.log()).toEqual([])
    expect((await repo.log({ all: true })).map((c) => c.subject)).toEqual(['segundo', 'primeiro'])
    // E de novo, agora sem a lembrança: continua correto.
    expect(await repo.log()).toEqual([])
  })

  it('HEAD destacado: log continua devolvendo os commits, inclusive com a lembrança', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    await t.commit('segundo', { 'a.txt': 'b\n' })
    const repo = await GitRepository.open(t.dir)
    await repo.log()
    await t.git('checkout', '-q', '--detach')
    expect((await repo.log()).map((c) => c.subject)).toEqual(['segundo', 'primeiro'])
  })
})

describe('Backend: processos git na abertura', () => {
  it('abrir um repositório roda um único rev-parse, sem rev-parse --git-dir', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    const backend = newBackend()
    const { processes } = await countGit(() => backend.invoke('app:openRepository', [t.dir]))
    const revParse = processes.filter((args) => args[0] === 'rev-parse')
    expect(revParse).toHaveLength(1)
    expect(revParse[0]).toContain('--show-toplevel')
    expect(revParse[0]).toContain('--absolute-git-dir')
    expect(processes.some((args) => args.includes('--git-dir'))).toBe(false)
  })

  it('chamadas repo:invoke com o root exato funcionam', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    const backend = newBackend()
    const info = (await backend.invoke('app:openRepository', [t.dir])) as { root: string }
    const status = (await backend.invoke('repo:invoke', ['status', [], info.root])) as { branch: string }
    expect(status.branch).toBe('main')
    const again = (await backend.invoke('repo:invoke', ['log', [{ all: true }], info.root])) as { subject: string }[]
    expect(again.map((c) => c.subject)).toEqual(['primeiro'])
  })

  it('o mesmo repositório por outro caminho (barra no fim) não é duplicado', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    const backend = newBackend()
    const first = await backend.setRepository(await GitRepository.open(t.dir))
    const again = await backend.setRepository(new GitRepository(t.dir + '/'))
    expect(again.root).toBe(first.root)
    expect((await backend.openRepositories()).repos).toHaveLength(1)
  })

  it('depois de fechar, o repositório pode ser aberto de novo', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    const backend = newBackend()
    const first = await backend.setRepository(await GitRepository.open(t.dir))
    await backend.closeRepository(first.root)
    expect((await backend.openRepositories()).repos).toHaveLength(0)
    await backend.setRepository(await GitRepository.open(t.dir))
    expect((await backend.openRepositories()).repos).toHaveLength(1)
  })
})
