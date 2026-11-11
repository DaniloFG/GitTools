import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Backend, type BackendHost } from '../src/backend/backend'
import { mapLimited } from '../src/backend/mapLimited'
import { GitRepository } from '../src/core/repository'
import type { OpenRepositories } from '../src/shared/types'

const dirs: string[] = []
const backends: Backend[] = []
afterEach(() => {
  backends.splice(0).forEach((b) => b.dispose())
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** Contador de chamadas em andamento: guarda o máximo visto ao mesmo tempo. */
function inFlight() {
  let now = 0
  const counter = {
    max: 0,
    async run<R>(work: () => Promise<R>): Promise<R> {
      now++
      counter.max = Math.max(counter.max, now)
      try {
        return await work()
      } finally {
        now--
      }
    }
  }
  return counter
}

describe('mapLimited', () => {
  it('devolve na ordem da lista mesmo quando as chamadas terminam fora de ordem', async () => {
    const items = [30, 5, 20, 1, 15, 10, 2, 25]
    const finished: number[] = []
    const result = await mapLimited(items, 3, async (ms, index) => {
      await wait(ms)
      finished.push(index)
      return `#${index}:${ms}`
    })
    expect(result).toEqual(items.map((ms, i) => `#${i}:${ms}`))
    // As chamadas de fato terminaram fora de ordem (senão o teste não provaria nada).
    expect(finished).not.toEqual([...finished].sort((a, b) => a - b))
  })

  it('nunca passa do limite e usa o limite todo enquanto há itens', async () => {
    const counter = inFlight()
    await mapLimited(Array.from({ length: 12 }, (_, i) => i), 4, (i) => counter.run(() => wait(2 + (i % 3) * 3)))
    expect(counter.max).toBe(4)
  })

  it('lista vazia, limite maior que a lista e limite inválido', async () => {
    expect(await mapLimited([], 4, async () => 1)).toEqual([])
    const counter = inFlight()
    expect(await mapLimited([1, 2], 10, (n) => counter.run(async () => n * 2))).toEqual([2, 4])
    expect(counter.max).toBe(2)
    const serial = inFlight()
    expect(await mapLimited([1, 2, 3], 0, (n) => serial.run(async () => n))).toEqual([1, 2, 3])
    expect(serial.max).toBe(1)
  })

  it('falha com o erro da chamada que falhou', async () => {
    await expect(
      mapLimited([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('falhou 2')
        return n
      })
    ).rejects.toThrow('falhou 2')
  })
})

describe('reabertura da sessão (reopenSaved)', () => {
  function backendWith(workspace: unknown) {
    const data = mkdtempSync(join(tmpdir(), 'gittools-reopen-'))
    dirs.push(data)
    writeFileSync(join(data, 'workspace.json'), JSON.stringify(workspace))
    const opened: string[] = []
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
      settingsChanged: () => undefined,
      repositoryOpened: (info) => opened.push(info.root)
    }
    const backend = new Backend(host)
    backends.push(backend)
    return { backend, opened }
  }

  it('abre em paralelo com limite, mantém a ordem das abas e descarta o que sumiu', async () => {
    // Raízes falsas (pastas que não existem): o observador da pasta .git falha e é ignorado, como hoje.
    const base = join(tmpdir(), 'gittools-reopen-falso')
    const paths = Array.from({ length: 10 }, (_, i) => join(base, `r${i}`))
    const gone = new Set([paths[2], paths[7]])
    // O mesmo repositório gravado duas vezes (outro caminho, mesma raiz) vira uma aba só.
    const alias = join(base, 'r4', 'sub')
    const counter = inFlight()
    // Falso de abertura: atrasos diferentes para que terminem fora de ordem; os de `gone` falham como
    // falharia o git numa pasta apagada.
    vi.spyOn(GitRepository, 'open').mockImplementation((path: string) =>
      counter.run(async () => {
        const index = paths.indexOf(path)
        await wait(index >= 0 ? (10 - index) * 2 : 1)
        if (gone.has(path)) throw new Error('não é um repositório git')
        return new GitRepository(path === alias ? paths[4] : path)
      })
    )

    const { backend, opened } = backendWith({ repos: [...paths, alias], active: paths[5] })
    const open = (await backend.invoke('app:openRepositories', [])) as OpenRepositories

    expect(open.repos.map((r) => r.root)).toEqual(paths.filter((p) => !gone.has(p)))
    expect(open.active).toBe(paths[5])
    expect(opened).toEqual([paths[5]])
    expect(GitRepository.open).toHaveBeenCalledTimes(11)
    expect(counter.max).toBeGreaterThan(1)
    expect(counter.max).toBeLessThanOrEqual(4)
  })

  it('ativo que sumiu: assume o primeiro reaberto, na ordem gravada', async () => {
    const base = join(tmpdir(), 'gittools-reopen-falso')
    const paths = ['a', 'b', 'c'].map((n) => join(base, n))
    vi.spyOn(GitRepository, 'open').mockImplementation(async (path: string) => {
      // O primeiro demora mais: se a ordem seguisse quem termina antes, "b" viraria a primeira aba.
      await wait(path === paths[0] ? 20 : 1)
      if (path === paths[2]) throw new Error('sumiu')
      return new GitRepository(path)
    })
    const { backend } = backendWith({ repos: paths, active: paths[2] })
    const open = (await backend.invoke('app:openRepositories', [])) as OpenRepositories
    expect(open.repos.map((r) => r.root)).toEqual([paths[0], paths[1]])
    expect(open.active).toBe(paths[0])
  })
})
