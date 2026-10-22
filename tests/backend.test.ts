import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Backend, type BackendHost } from '../src/backend/backend'
import { BRIDGE_CHANNELS } from '../src/shared/channels'
import { DEFAULT_SETTINGS } from '../src/shared/settings'
import { createRepo } from './helpers'

const dirs: string[] = []
const backends: Backend[] = []
afterEach(() => {
  backends.splice(0).forEach((b) => b.dispose())
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function fakeHost(overrides: Partial<BackendHost> = {}) {
  const data = mkdtempSync(join(tmpdir(), 'gittools-data-'))
  dirs.push(data)
  const events: { channel: string; payload?: unknown }[] = []
  const opened: string[] = []
  const host: BackendHost = {
    dataDir: () => data,
    homeDir: () => data,
    documentsDir: () => data,
    systemLocales: () => ['pt-BR'],
    versions: () => ({ host: 'vscode', version: '1.0.0', electron: '', chrome: '', node: process.versions.node, platform: 'test' }),
    emit: (channel, payload) => events.push({ channel, payload }),
    pickFolder: async () => null,
    openPath: async (p) => void opened.push(p),
    openInEditor: async (target) => void opened.push(target),
    testEditor: async (_s, target) => void opened.push(target),
    detectEditors: () => [],
    chooseEditor: async () => null,
    openDiffWindow: () => undefined,
    settingsChanged: () => undefined,
    ...overrides
  }
  const backend = new Backend(host)
  backends.push(backend)
  return { backend, events, opened, data }
}

describe('Backend', () => {
  it('abre um repositório, lembra dos recentes e responde aos métodos do repositório', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    const { backend } = fakeHost()
    const info = (await backend.invoke('app:openRepository', [t.dir])) as { name: string }
    expect(info.name).toBeTruthy()
    expect(await backend.invoke('app:currentRepository', [])).toMatchObject({ root: info && (await t.repo.info()).root })
    const log = (await backend.invoke('repo:invoke', ['log', [{ all: true }]])) as { subject: string }[]
    expect(log.map((c) => c.subject)).toEqual(['primeiro'])
    expect((await backend.invoke('app:recentRepositories', [])) as unknown[]).toHaveLength(1)
  })

  it('recusa métodos fora da lista e chamadas sem repositório', async () => {
    const { backend } = fakeHost()
    await expect(backend.invoke('repo:invoke', ['status', []])).rejects.toThrow()
    const t = await createRepo()
    await backend.invoke('app:openRepository', [t.dir])
    await expect(backend.invoke('repo:invoke', ['constructor', []])).rejects.toThrow()
  })

  it('guarda configurações validadas e avisa o ambiente', async () => {
    const seen: unknown[] = []
    const { backend } = fakeHost({ settingsChanged: (s) => void seen.push(s) })
    expect(await backend.invoke('app:getSettings', [])).toEqual(DEFAULT_SETTINGS)
    await backend.invoke('app:saveSettings', [{ theme: 'dark', zoom: 99, toast: { vertical: 'top' } }])
    const saved = (await backend.invoke('app:getSettings', [])) as typeof DEFAULT_SETTINGS
    expect(saved.theme).toBe('dark')
    expect(saved.zoom).toBe(DEFAULT_SETTINGS.zoom)
    expect(saved.toast.vertical).toBe('top')
    expect(seen).toHaveLength(1)
  })

  it('registra os comandos git e os repassa à interface', async () => {
    const t = await createRepo()
    const { backend, events } = fakeHost()
    await backend.invoke('app:openRepository', [t.dir])
    await backend.invoke('repo:invoke', ['status', []])
    const log = (await backend.invoke('app:gitLog', [])) as { args: string[] }[]
    expect(log.some((e) => e.args[0] === 'status')).toBe(true)
    expect(events.some((e) => e.channel === 'git:command')).toBe(true)
  })

  it('abre arquivos pelo caminho absoluto e avisa quando o arquivo não existe', async () => {
    const t = await createRepo()
    await t.commit('c', { 'src/app.ts': 'x\n' })
    const { backend, opened } = fakeHost()
    await backend.invoke('app:openRepository', [t.dir])
    await backend.invoke('app:openInEditor', ['src/app.ts'])
    await backend.invoke('app:openFile', ['src/app.ts'])
    expect(opened).toEqual([join(t.repo.root, 'src', 'app.ts'), join(t.repo.root, 'src', 'app.ts')])
    await expect(backend.invoke('app:openInEditor', ['nao-existe.ts'])).rejects.toThrow(/nao-existe/)
    await expect(backend.invoke('app:openInEditor', ['../fora.txt'])).rejects.toThrow()
    await backend.invoke('app:openInEditor', ['.'])
    expect(opened).toHaveLength(3)
  })

  it('o teste do editor abre um arquivo do repositório', async () => {
    const t = await createRepo()
    await t.commit('c', { 'a.txt': 'a\n' })
    const { backend, opened } = fakeHost()
    await backend.invoke('app:openRepository', [t.dir])
    await backend.invoke('app:testEditor', ['qualquer'])
    expect(opened).toEqual([join(t.repo.root, 'a.txt')])
  })

  it('informa o ambiente e o git em Sobre', async () => {
    const { backend, data } = fakeHost()
    const info = (await backend.invoke('app:info', [])) as { host: string; git: string | null; settingsFile: string }
    expect(info.host).toBe('vscode')
    expect(info.git).toMatch(/^\d/)
    expect(info.settingsFile).toBe(join(data, 'settings.json'))
  })

  it('tem um canal para cada pedido da ponte', () => {
    expect(new Set(BRIDGE_CHANNELS).size).toBe(BRIDGE_CHANNELS.length)
  })
})
