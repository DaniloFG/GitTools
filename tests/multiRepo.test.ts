import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Backend, type BackendHost } from '../src/backend/backend'
import { runGit } from '../src/core/exec'
import { GitRepository } from '../src/core/repository'
import type { GitCommandEntry, OpenRepositories, OperationResult, RepoStatus } from '../src/shared/types'
import { createRepo, type TestRepo } from './helpers'

const dirs: string[] = []
const backends: Backend[] = []
afterEach(() => {
  backends.splice(0).forEach((b) => b.dispose())
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const newDataDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'gittools-multi-'))
  dirs.push(dir)
  return dir
}

/** Backend com a pasta de dados `data` (pode ser reaproveitada por outro Backend, como numa nova sessão). */
function fakeHost(data = newDataDir()) {
  const events: { channel: string; payload?: unknown }[] = []
  const host: BackendHost = {
    dataDir: () => data,
    homeDir: () => data,
    documentsDir: () => data,
    systemLocales: () => ['pt-BR'],
    versions: () => ({ host: 'vscode', version: '1.0.0', electron: '', chrome: '', node: process.versions.node, platform: 'test' }),
    emit: (channel, payload) => {
      events.push({ channel, payload })
    },
    pickFolder: async () => null,
    openPath: async () => undefined,
    openInEditor: async () => undefined,
    testEditor: async () => undefined,
    detectEditors: () => [],
    chooseEditor: async () => null,
    openDiffWindow: () => undefined,
    settingsChanged: () => undefined
  }
  const backend = new Backend(host)
  backends.push(backend)
  return { backend, events, data }
}

/** Quantos observadores de pasta .git estão ativos (campo interno, conferido só aqui). */
const watcherCount = (b: Backend) => (b as unknown as { watchers: Map<string, unknown> }).watchers.size

const openRepo = (backend: Backend, path: string) => backend.invoke('app:openRepository', [path])

const openList = async (backend: Backend) => (await backend.invoke('app:openRepositories', [])) as OpenRepositories

/** Commit com data do committer definida (o cherry-pick ordena os commits por essa data). */
async function commitAt(repo: TestRepo, message: string, files: Record<string, string>, seconds: number): Promise<string> {
  for (const [path, content] of Object.entries(files)) repo.write(path, content)
  await repo.git('add', '-A')
  const date = `${seconds} +0000`
  await runGit(repo.dir, ['commit', '-q', '-m', message], { env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } })
  return (await repo.git('rev-parse', 'HEAD')).trim()
}

async function waitFor(condition: () => boolean, timeoutMs = 5000) {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('o aviso não chegou a tempo')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe('vários repositórios abertos', () => {
  it('abre três repositórios, alterna entre eles e fecha o ativo ativando o vizinho', async () => {
    const a = await createRepo()
    const b = await createRepo()
    const c = await createRepo()
    await a.commit('a', { 'a.txt': 'a\n' })
    await b.commit('b', { 'b.txt': 'b\n' })
    await c.commit('c', { 'c.txt': 'c\n' })
    const { backend } = fakeHost()
    await openRepo(backend, a.dir)
    await openRepo(backend, b.dir)
    await openRepo(backend, c.dir)

    let open = await openList(backend)
    expect(open.repos.map((r) => r.root)).toEqual([a.repo.root, b.repo.root, c.repo.root])
    expect(open.active).toBe(c.repo.root)
    expect(watcherCount(backend)).toBe(3)

    await backend.invoke('app:switchRepository', [a.repo.root])
    expect(await backend.invoke('app:currentRepository', [])).toMatchObject({ root: a.repo.root })

    // Fechar o ativo (o primeiro da lista) ativa o vizinho da direita.
    open = (await backend.invoke('app:closeRepository', [a.repo.root])) as OpenRepositories
    expect(open.active).toBe(b.repo.root)
    expect(open.repos.map((r) => r.root)).toEqual([b.repo.root, c.repo.root])
    expect(watcherCount(backend)).toBe(2)
    // Fechar um repositório que não é o ativo não muda o ativo.
    open = (await backend.invoke('app:closeRepository', [c.repo.root])) as OpenRepositories
    expect(open).toMatchObject({ active: b.repo.root })
    // Fechar o último: nenhum ativo.
    open = (await backend.invoke('app:closeRepository', [b.repo.root])) as OpenRepositories
    expect(open).toEqual({ repos: [], active: null })
    expect(backend.repo).toBeNull()
    expect(watcherCount(backend)).toBe(0)
    // Fechar só tira da sessão: os arquivos continuam no disco.
    expect(readFileSync(join(a.dir, 'a.txt'), 'utf8')).toBe('a\n')
  })

  it('fechar o ativo na extremidade direita ativa o vizinho da esquerda', async () => {
    const a = await createRepo()
    const b = await createRepo()
    await a.commit('a', { 'a.txt': 'a\n' })
    await b.commit('b', { 'b.txt': 'b\n' })
    const { backend } = fakeHost()
    await openRepo(backend, a.dir)
    await openRepo(backend, b.dir)
    expect(backend.repo?.root).toBe(b.repo.root)
    expect(await backend.invoke('app:closeRepository', [b.repo.root])).toEqual({ repos: [{ root: a.repo.root, name: a.repo.root.split(sep).pop() }], active: a.repo.root })
  })

  it('abrir um caminho já aberto só ativa: não duplica (barra final, relativo ou subpasta)', async () => {
    const a = await createRepo()
    const b = await createRepo()
    await a.commit('a', { 'a.txt': 'a\n', 'sub/x.txt': 'x\n' })
    await b.commit('b', { 'b.txt': 'b\n' })
    const { backend } = fakeHost()
    await openRepo(backend, a.dir)
    await openRepo(backend, b.dir)
    expect(backend.repo?.root).toBe(b.repo.root)

    await openRepo(backend, a.dir + sep)
    expect(backend.repo?.root).toBe(a.repo.root)
    await openRepo(backend, relative(process.cwd(), b.dir))
    expect(backend.repo?.root).toBe(b.repo.root)
    await openRepo(backend, join(a.dir, 'sub'))
    expect(backend.repo?.root).toBe(a.repo.root)

    const open = await openList(backend)
    expect(open.repos.map((r) => r.root)).toEqual([a.repo.root, b.repo.root])
    expect(open.active).toBe(a.repo.root)
    expect(watcherCount(backend)).toBe(2)
  })

  it('invokeOn: cada pedido vai para o repositório informado; um stage em A não mexe em B', async () => {
    const a = await createRepo()
    const b = await createRepo()
    await a.commit('a', { 'a.txt': 'a\n' })
    await b.commit('b', { 'b.txt': 'b\n' })
    const { backend } = fakeHost()
    await openRepo(backend, a.dir)
    await openRepo(backend, b.dir) // ativo: b

    a.write('novo.txt', 'x\n')
    await backend.invoke('repo:invoke', ['stageFiles', [['novo.txt']], a.repo.root])

    const statusA = (await backend.invoke('repo:invoke', ['status', [], a.repo.root])) as RepoStatus
    expect(statusA.staged.map((f) => f.path)).toEqual(['novo.txt'])
    const statusB = (await backend.invoke('repo:invoke', ['status', [], b.repo.root])) as RepoStatus
    expect(statusB.staged).toEqual([])
    expect(statusB.unstaged).toEqual([])
    // Sem root, vale o ativo (B).
    expect(await backend.invoke('repo:invoke', ['status', []])).toEqual(statusB)

    // O log de comandos identifica o repositório pelo cwd.
    const log = (await backend.invoke('app:gitLog', [])) as GitCommandEntry[]
    expect(log.some((e) => e.cwd === a.repo.root && e.args.includes('add'))).toBe(true)
    expect(log.some((e) => e.cwd === b.repo.root && e.args[0] === 'status')).toBe(true)
  })

  it('root que não está aberto dá erro claro e nunca cai no repositório ativo', async () => {
    const a = await createRepo()
    const fora = await createRepo()
    await a.commit('a', { 'a.txt': 'a\n' })
    await fora.commit('f', { 'f.txt': 'f\n' })
    const { backend } = fakeHost()
    await openRepo(backend, a.dir)

    await expect(backend.invoke('repo:invoke', ['status', [], fora.repo.root])).rejects.toThrow(/não está aberto/)
    await expect(backend.invoke('repo:invoke', ['status', [], '/caminho/que/nao/existe'])).rejects.toThrow(/não está aberto/)
    await expect(backend.invoke('repo:invoke', ['status', [], ''])).rejects.toThrow(/não está aberto/)
    await expect(backend.invoke('app:openInEditor', ['a.txt', fora.repo.root])).rejects.toThrow(/não está aberto/)
    await expect(backend.invoke('app:switchRepository', ['/caminho/que/nao/existe'])).rejects.toThrow(/não está aberto/)
    await expect(backend.invoke('app:closeRepository', [fora.repo.root])).rejects.toThrow(/não está aberto/)
    await expect(backend.invoke('app:cherryPickAcross', [a.repo.root, fora.repo.root, []])).rejects.toThrow(/não está aberto/)
    // Nada mudou: o ativo continua sendo o único aberto.
    expect((await openList(backend)).repos.map((r) => r.root)).toEqual([a.repo.root])

    // Sem nenhum repositório aberto, um pedido sem root também falha.
    const vazio = fakeHost().backend
    await expect(vazio.invoke('repo:invoke', ['status', []])).rejects.toThrow(/Nenhum repositório/)
  })

  it('grava workspace.json e reabre os repositórios (com o ativo) na sessão seguinte', async () => {
    const data = newDataDir()
    const a = await createRepo()
    const b = await createRepo()
    const c = await createRepo()
    await a.commit('a', { 'a.txt': 'a\n' })
    await b.commit('b', { 'b.txt': 'b\n' })
    await c.commit('c', { 'c.txt': 'c\n' })

    const first = fakeHost(data)
    await openRepo(first.backend, a.dir)
    await openRepo(first.backend, b.dir)
    await openRepo(first.backend, c.dir)
    await first.backend.invoke('app:switchRepository', [b.repo.root])
    first.backend.dispose()
    expect(JSON.parse(readFileSync(join(data, 'workspace.json'), 'utf8'))).toEqual({
      repos: [a.repo.root, b.repo.root, c.repo.root],
      active: b.repo.root
    })

    const second = fakeHost(data).backend
    const open = await openList(second)
    expect(open.repos.map((r) => r.root)).toEqual([a.repo.root, b.repo.root, c.repo.root])
    expect(open.active).toBe(b.repo.root)
    expect(second.repo?.root).toBe(b.repo.root)
    expect(watcherCount(second)).toBe(3)
  })

  it('repositório que sumiu da pasta é descartado em silêncio ao reabrir', async () => {
    const data = newDataDir()
    const a = await createRepo()
    const b = await createRepo()
    await a.commit('a', { 'a.txt': 'a\n' })
    await b.commit('b', { 'b.txt': 'b\n' })
    const first = fakeHost(data)
    await openRepo(first.backend, a.dir)
    await openRepo(first.backend, b.dir) // ativo: b
    first.backend.dispose()
    rmSync(b.dir, { recursive: true, force: true })

    const second = fakeHost(data).backend
    const open = await openList(second)
    expect(open.repos.map((r) => r.root)).toEqual([a.repo.root])
    // O ativo sumiu: assume o primeiro reaberto.
    expect(open.active).toBe(a.repo.root)
    expect(JSON.parse(readFileSync(join(data, 'workspace.json'), 'utf8'))).toEqual({ repos: [a.repo.root], active: a.repo.root })
  })

  it('workspace.json corrompido, com formato errado ou ausente não derruba a abertura', async () => {
    const data = newDataDir()
    writeFileSync(join(data, 'workspace.json'), '{ isto não é json')
    const { backend } = fakeHost(data)
    expect(await openList(backend)).toEqual({ repos: [], active: null })

    // Ao abrir algo, o arquivo volta a ser gravado de forma válida.
    const a = await createRepo()
    await a.commit('a', { 'a.txt': 'a\n' })
    await openRepo(backend, a.dir)
    expect(JSON.parse(readFileSync(join(data, 'workspace.json'), 'utf8'))).toEqual({ repos: [a.repo.root], active: a.repo.root })

    const formato = newDataDir()
    writeFileSync(join(formato, 'workspace.json'), JSON.stringify({ repos: 'x', active: 3 }))
    expect(await openList(fakeHost(formato).backend)).toEqual({ repos: [], active: null })
  })

  it('observador da pasta .git avisa só o repositório que mudou, com { root }', async () => {
    const a = await createRepo()
    const b = await createRepo()
    await a.commit('a', { 'a.txt': 'a\n' })
    await b.commit('b', { 'b.txt': 'b\n' })
    const { backend, events } = fakeHost()
    await openRepo(backend, a.dir)
    await openRepo(backend, b.dir)

    a.write('mudou.txt', 'x\n')
    await a.git('add', '-A')
    await waitFor(() => events.some((e) => e.channel === 'repo:changed'))
    const changed = events.filter((e) => e.channel === 'repo:changed')
    expect(changed.every((e) => (e.payload as { root: string }).root === a.repo.root)).toBe(true)
  })

  it('fechar um repositório para de observar a pasta dele', async () => {
    const a = await createRepo()
    const b = await createRepo()
    await a.commit('a', { 'a.txt': 'a\n' })
    await b.commit('b', { 'b.txt': 'b\n' })
    const { backend, events } = fakeHost()
    await openRepo(backend, a.dir)
    await openRepo(backend, b.dir)
    await backend.invoke('app:closeRepository', [a.repo.root])
    expect(watcherCount(backend)).toBe(1)

    a.write('depois.txt', 'x\n')
    await a.git('add', '-A')
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(events.some((e) => e.channel === 'repo:changed' && (e.payload as { root: string }).root === a.repo.root)).toBe(false)
  })
})

describe('cherryPickAcross', () => {
  /** Origem com três commits (com datas crescentes) e destino com um commit próprio. Ambos abertos. */
  async function fixtures() {
    const s = await createRepo()
    await commitAt(s, 'base', { 'base.txt': 'base\n' }, 1_700_000_000)
    const c1 = await commitAt(s, 'adiciona s1', { 's1.txt': 'origem\n' }, 1_700_000_060)
    const c2 = await commitAt(s, 'adiciona s2', { 's2.txt': 'dois\n' }, 1_700_000_120)
    const c3 = await commitAt(s, 'altera s1', { 's1.txt': 'origem v2\n' }, 1_700_000_180)
    const destino = await createRepo()
    await commitAt(destino, 'base destino', { 't.txt': 'destino\n' }, 1_600_000_000)
    const { backend } = fakeHost()
    await openRepo(backend, s.dir)
    await openRepo(backend, destino.dir)
    /** Assuntos dos commits do destino, do mais antigo para o mais novo. */
    const subjects = async () => (await destino.git('log', '--format=%s')).trim().split('\n').reverse()
    return { s, destino, c1, c2, c3, backend, subjects }
  }

  it('traz um commit de outro repositório para a branch atual (arquivo solto não atrapalha)', async () => {
    const { s, destino, c1, backend, subjects } = await fixtures()
    destino.write('solto.txt', 'não rastreado\n')
    const result = (await backend.invoke('app:cherryPickAcross', [s.repo.root, destino.repo.root, [c1]])) as OperationResult
    expect(result).toMatchObject({ ok: true, conflicts: [] })
    expect(readFileSync(join(destino.dir, 's1.txt'), 'utf8')).toBe('origem\n')
    expect(await subjects()).toEqual(['base destino', 'adiciona s1'])
  })

  it('vários commits saem em ordem cronológica de topo, mesmo pedidos fora de ordem', async () => {
    const { s, destino, c1, c2, c3, backend, subjects } = await fixtures()
    const result = (await backend.invoke('app:cherryPickAcross', [s.repo.root, destino.repo.root, [c3, c1, c2]])) as OperationResult
    expect(result.ok).toBe(true)
    expect(readFileSync(join(destino.dir, 's1.txt'), 'utf8')).toBe('origem v2\n')
    expect(readFileSync(join(destino.dir, 's2.txt'), 'utf8')).toBe('dois\n')
    expect(await subjects()).toEqual(['base destino', 'adiciona s1', 'adiciona s2', 'altera s1'])
  })

  it('conflito volta em conflicts, deixa a operação em andamento e bloqueia um novo pedido', async () => {
    const { s, destino, c1, c2, backend } = await fixtures()
    await destino.commit('destino mexe em s1', { 's1.txt': 'destino\n' })
    const result = (await backend.invoke('app:cherryPickAcross', [s.repo.root, destino.repo.root, [c1]])) as OperationResult
    expect(result.ok).toBe(false)
    expect(result.conflicts).toEqual(['s1.txt'])
    expect((await destino.repo.operationState()).kind).not.toBe('none')

    // Com a operação em andamento no destino, um novo pedido é recusado sem mexer no destino.
    const headAntes = (await destino.git('rev-parse', 'HEAD')).trim()
    await expect(backend.invoke('app:cherryPickAcross', [s.repo.root, destino.repo.root, [c2]])).rejects.toThrow(/operação em andamento/)
    expect((await destino.git('rev-parse', 'HEAD')).trim()).toBe(headAntes)

    await destino.repo.abortOperation()
    expect((await destino.repo.operationState()).kind).toBe('none')
  })

  it('destino com alterações não commitadas: erro e nenhum efeito', async () => {
    const { s, destino, c1, backend } = await fixtures()
    destino.write('t.txt', 'alterado\n')
    const headAntes = (await destino.git('rev-parse', 'HEAD')).trim()
    await expect(backend.invoke('app:cherryPickAcross', [s.repo.root, destino.repo.root, [c1]])).rejects.toThrow(/não foram commitadas/)
    expect((await destino.git('rev-parse', 'HEAD')).trim()).toBe(headAntes)
    expect((await destino.repo.status()).unstaged.map((f) => f.path)).toEqual(['t.txt'])
    // Nem os objetos da origem foram trazidos.
    await expect(destino.git('cat-file', '-e', c1)).rejects.toThrow()
  })

  it('destino sem branch (HEAD destacado): erro e nenhum efeito', async () => {
    const { s, destino, c1, backend } = await fixtures()
    await destino.git('checkout', '--detach')
    await expect(backend.invoke('app:cherryPickAcross', [s.repo.root, destino.repo.root, [c1]])).rejects.toThrow(/sem branch/)
    await expect(destino.git('cat-file', '-e', c1)).rejects.toThrow()
  })

  it('origem e destino iguais: erro', async () => {
    const { destino, c1, backend } = await fixtures()
    await expect(backend.invoke('app:cherryPickAcross', [destino.repo.root, destino.repo.root, [c1]])).rejects.toThrow(/diferentes/)
  })

  it('não deixa refs temporárias, também no caminho de reserva (refs da origem)', async () => {
    const { s, destino, c1, backend } = await fixtures()
    const proto = GitRepository.prototype as unknown as { fetchBySha(...args: unknown[]): Promise<void>; fetchByRefs(...args: unknown[]): Promise<void> }
    // Simula um git que não aceita pedir commit pelo sha: o caminho de reserva tem de dar conta.
    vi.spyOn(proto, 'fetchBySha').mockRejectedValueOnce(new Error('sha não aceito'))
    const fallback = vi.spyOn(proto, 'fetchByRefs')

    const result = (await backend.invoke('app:cherryPickAcross', [s.repo.root, destino.repo.root, [c1]])) as OperationResult
    expect(result.ok).toBe(true)
    expect(fallback).toHaveBeenCalledOnce()
    expect(readFileSync(join(destino.dir, 's1.txt'), 'utf8')).toBe('origem\n')
    expect((await destino.git('for-each-ref', 'refs/gittools-tmp', 'refs/remotes')).trim()).toBe('')
    expect((await s.git('for-each-ref', 'refs/gittools-tmp')).trim()).toBe('')
  })

  it('no caminho normal não sobra ref temporária nem de remoto', async () => {
    const { s, destino, c1, c2, backend } = await fixtures()
    await backend.invoke('app:cherryPickAcross', [s.repo.root, destino.repo.root, [c1, c2]])
    expect((await destino.git('for-each-ref', 'refs/gittools-tmp', 'refs/remotes')).trim()).toBe('')
  })
})
