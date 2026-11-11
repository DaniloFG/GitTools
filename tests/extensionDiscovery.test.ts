// Abertura do painel da extensão com descoberta por trás (item 5.4, achado D5 de docs/PERFORMANCE.md):
// o painel aparece antes da varredura; a interface só recebe a lista de abertos quando a varredura termina
// (sem piscar a tela de boas-vindas); e a descoberta grava uma vez no fim, não uma vez por repositório.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fake, Memento, Uri, type FakePanel } from './support/vscode'
import { onGitCommand, runGit } from '../src/core/exec'
import { activate } from '../extension/src/extension'

// Conta as gravações de arquivo do backend (recentes, workspace.json) sem mudar o que elas fazem.
const written: string[] = []
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return {
    ...actual,
    writeFile: (...args: Parameters<typeof actual.writeFile>) => {
      written.push(String(args[0]))
      return actual.writeFile(...args)
    }
  }
})

const INDEX = '<!doctype html><html><head><title>GitTools</title></head><body></body></html>'
const dirs: string[] = []
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

/** Uma janela nova do VS Code (estado vazio), com a pasta da extensão e o estado da janela contando gravações. */
function start() {
  const root = temp('gittools-ext-disc-')
  mkdirSync(join(root, 'dist', 'webview'), { recursive: true })
  writeFileSync(join(root, 'dist', 'webview', 'index.html'), INDEX)
  const state = new Memento()
  const stateWrites: unknown[] = []
  const update = state.update.bind(state)
  state.update = (key: string, value: unknown) => {
    stateWrites.push(value)
    return update(key, value)
  }
  const subscriptions: { dispose(): void }[] = []
  activate({
    subscriptions,
    extensionUri: Uri.file(root),
    globalStorageUri: Uri.file(join(root, 'storage')),
    workspaceState: state,
    extension: { packageJSON: { version: '9.9.9' } }
  } as never)
  const handlers = new Map(fake.commands)
  return { stateWrites, subscriptions, run: (id: string) => handlers.get(id)!() }
}

/** Espera a resposta de um pedido enviado ao painel. */
async function ask(panel: FakePanel, channel: string, ...args: unknown[]) {
  const id = Math.floor(Math.random() * 1e9)
  panel.send({ type: 'request', id, channel, args })
  for (let i = 0; i < 500; i++) {
    const reply = panel.webview.posted.find((m) => (m as { id?: number }).id === id) as { ok: boolean; result?: unknown } | undefined
    if (reply) return reply
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('sem resposta')
}

/** Pasta do workspace (não é repositório) com três repositórios dentro. */
async function threeRepos() {
  const folder = realpathSync(temp('gittools-ws-'))
  const roots = ['alfa', 'beta', join('grupo', 'gama')].map((name) => join(folder, name))
  for (const root of roots) {
    mkdirSync(root, { recursive: true })
    await runGit(root, ['init', '-q'])
  }
  return { folder, roots }
}

beforeEach(() => {
  fake.reset()
  written.length = 0
})
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('extensão: painel primeiro, descoberta por trás', () => {
  it('três repositórios no workspace: a lista chega completa, com poucos processos git e uma gravação de cada', async () => {
    const { folder, roots } = await threeRepos()
    fake.workspaceFolders = [{ uri: Uri.file(folder) }]
    const commands: string[] = []
    const stop = onGitCommand((entry) => {
      if (entry.exitCode === undefined) commands.push(entry.args.join(' '))
    })
    const w = start()
    await w.run('gittools.open')
    expect(fake.panels).toHaveLength(1)
    // O primeiro pedido da interface já traz os três (a resposta espera a descoberta): nada de "nenhum aberto".
    const list = (await ask(fake.panels[0], 'app:openRepositories')).result as { repos: { root: string }[]; active: string }
    stop()
    expect(list.repos.map((r) => r.root)).toEqual(roots)
    expect(list.active).toBe(roots[0])
    expect(fake.panels[0].title).toBe('GitTools — alfa')
    const recent = written.filter((p) => p.endsWith('recent-repositories.json'))
    console.log(`[D5] processos git: ${commands.length}; gravações dos recentes: ${recent.length}; gravações do estado da janela: ${w.stateWrites.length}`)
    expect(commands).toHaveLength(3)
    expect(recent).toHaveLength(1)
    expect(w.stateWrites).toHaveLength(1)
    expect(w.stateWrites[0]).toEqual({ repos: roots, active: roots[0] })
    // Os recentes ficam como antes: o último aberto primeiro.
    const recents = (await ask(fake.panels[0], 'app:recentRepositories')).result as { path: string }[]
    expect(recents.map((r) => r.path)).toEqual([...roots].reverse())
    w.subscriptions.forEach((s) => s.dispose())
  })

  it('o painel é criado antes de a varredura terminar, e o pedido da lista espera por ela', async () => {
    const { folder, roots } = await threeRepos()
    fake.workspaceFolders = [{ uri: Uri.file(folder) }]
    const w = start()
    const opening = w.run('gittools.open') as Promise<void>
    // O painel existe já na primeira volta, sem esperar a descoberta.
    await Promise.resolve()
    expect(fake.panels).toHaveLength(1)
    const panel = fake.panels[0]
    // Configurações não esperam a descoberta (a interface aplica tema e idioma enquanto carrega).
    expect((await ask(panel, 'app:getSettings')).ok).toBe(true)
    const list = (await ask(panel, 'app:openRepositories')).result as { repos: { root: string }[] }
    expect(list.repos.map((r) => r.root)).toEqual(roots)
    await opening
    // Na abertura, o painel não recebe "repo:changed": a lista já veio completa (um aviso faria a interface reler tudo).
    expect(panel.webview.posted).not.toContainEqual({ type: 'event', channel: 'repo:changed' })
    w.subscriptions.forEach((s) => s.dispose())
  })
})
