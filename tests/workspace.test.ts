import { afterEach, describe, expect, it, vi } from 'vitest'
import { addToast } from '../src/renderer/src/feedback'
import {
  CallGate,
  cycleIndex,
  normalizeRoot,
  prefixToast,
  repoColor,
  repoHue,
  repoNameOf,
  sameRoot,
  summarize,
  unsavedWork,
  type RepoSummary
} from '../src/renderer/src/workspace'
import type { RepoStatus } from '../src/shared/types'

const status = (over: Partial<RepoStatus> = {}): RepoStatus => ({
  branch: 'main',
  detached: false,
  headSha: 'abc1234def',
  upstream: null,
  ahead: 0,
  behind: 0,
  staged: [],
  unstaged: [],
  conflicted: [],
  ...over
})

const file = { path: 'a.txt' } as RepoStatus['unstaged'][number]
const A = '/repos/alpha'
const B = '/repos/beta'

describe('cor de cada repositório', () => {
  it('é sempre a mesma para o mesmo caminho, mesmo com barra final ou barras invertidas', () => {
    expect(repoColor('/home/ana/acme')).toBe(repoColor('/home/ana/acme'))
    expect(repoColor('/home/ana/acme/')).toBe(repoColor('/home/ana/acme'))
    expect(repoColor('C:\\dev\\acme')).toBe(repoColor('C:/dev/acme'))
  })

  it('sai no formato hsl com matiz entre 0 e 359 e saturação/luminosidade fixas', () => {
    expect(repoColor('/x/y')).toMatch(/^hsl\(\d{1,3} 68% 52%\)$/)
    for (let i = 0; i < 200; i++) {
      const hue = repoHue(`/repos/projeto-${i}`)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    }
  })

  it('distingue repositórios diferentes na maioria dos casos (matizes bem espalhados)', () => {
    const hues = new Set(Array.from({ length: 40 }, (_, i) => repoHue(`/repos/projeto-${i}`)))
    expect(hues.size).toBeGreaterThan(25)
  })
})

describe('caminhos e nomes', () => {
  it('normaliza barras e barra final, e no Windows ignora maiúsculas', () => {
    expect(normalizeRoot('/a/b/')).toBe('/a/b')
    expect(normalizeRoot('C:\\Dev\\App\\')).toBe('c:/dev/app')
    expect(sameRoot('C:\\Dev\\App', 'c:/dev/app/')).toBe(true)
    expect(sameRoot('/a/b', '/a/bc')).toBe(false)
  })

  it('tira o nome do repositório da última pasta do caminho', () => {
    expect(repoNameOf('/home/ana/acme-shop/')).toBe('acme-shop')
    expect(repoNameOf('C:\\dev\\app')).toBe('app')
  })
})

describe('troca entre abas', () => {
  it('avança e volta de forma circular', () => {
    expect(cycleIndex(3, 0, 1)).toBe(1)
    expect(cycleIndex(3, 2, 1)).toBe(0)
    expect(cycleIndex(3, 0, -1)).toBe(2)
    expect(cycleIndex(3, 1, -1)).toBe(0)
  })

  it('sem aba ativa, vai para a primeira (ou a última, indo para trás)', () => {
    expect(cycleIndex(4, -1, 1)).toBe(0)
    expect(cycleIndex(4, -1, -1)).toBe(3)
  })

  it('com uma aba só ou nenhuma, fica onde está', () => {
    expect(cycleIndex(1, 0, 1)).toBe(0)
    expect(cycleIndex(0, -1, 1)).toBe(-1)
  })
})

describe('avisos de uma ação', () => {
  it('cita o repositório entre colchetes só quando há mais de um aberto', () => {
    expect(prefixToast('Commits aplicados.', 'acme', true)).toBe('[acme] Commits aplicados.')
    expect(prefixToast('Commits aplicados.', 'acme', false)).toBe('Commits aplicados.')
  })

  it('um aviso com ação não é fundido com outro igual (a ação é de um momento só)', () => {
    const now = 1000
    const first = addToast([], { kind: 'success', text: 'ok' }, now, 1)
    const withAction = addToast(first, { kind: 'success', text: 'ok', action: { label: 'Ir', run: () => undefined } }, now + 10, 2)
    expect(withAction).toHaveLength(2)
    expect(withAction[1].action?.label).toBe('Ir')
  })
})

describe('resumo e trabalho em aberto', () => {
  it('conta alterações (stage, área de trabalho e conflitos) e marca a operação', () => {
    const s = summarize(status({ staged: [file], unstaged: [file, file], conflicted: [file] }), 'cherry-pick')
    expect(s).toEqual<RepoSummary>({ branch: 'main', detached: false, headSha: 'abc1234def', changes: 4, conflicts: 1, operation: 'cherry-pick' })
  })

  it('HEAD destacado não tem branch', () => {
    expect(summarize(status({ detached: true, branch: 'main' }), 'none').branch).toBeNull()
  })

  it('repositório limpo, sem operação e sem texto não salvo não tem trabalho em aberto', () => {
    expect(unsavedWork(summarize(status(), 'none'), 0)).toEqual([])
    expect(unsavedWork(undefined, 0)).toEqual([])
  })

  it('lista cada motivo de trabalho em aberto', () => {
    const s = summarize(status({ unstaged: [file] }), 'merge')
    expect(unsavedWork(s, 2)).toEqual([
      { kind: 'changes', count: 1 },
      { kind: 'operation', operation: 'merge' },
      { kind: 'drafts', count: 2 }
    ])
  })
})

describe('portão de chamadas (troca de aba), por repositório', () => {
  afterEach(() => vi.useRealTimers())

  it('conta as chamadas em andamento de cada repositório e não conta duas vezes a mesma saída', async () => {
    const gate = new CallGate()
    const leave1 = await gate.enter(A)
    const leave2 = await gate.enter(A)
    await gate.enter(B)
    expect(gate.inFlight(A)).toBe(2)
    expect(gate.inFlight(B)).toBe(1)
    leave1()
    leave1()
    expect(gate.inFlight(A)).toBe(1)
    leave2()
    expect(gate.inFlight(A)).toBe(0)
  })

  it('segura as chamadas novas do repositório fechado, e libera ao abrir', async () => {
    const gate = new CallGate()
    gate.close(A)
    expect(gate.isClosed(A)).toBe(true)
    let entered = false
    const pending = gate.enter(A).then((leave) => {
      entered = true
      leave()
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(entered).toBe(false)
    gate.open(A)
    await pending
    expect(entered).toBe(true)
  })

  it('fechar A não segura as chamadas de B', async () => {
    const gate = new CallGate()
    gate.close(A)
    const leave = await gate.enter(B)
    expect(gate.inFlight(B)).toBe(1)
    leave()
    gate.open(A)
  })

  it('espera as chamadas do repositório que sai terminarem antes de dar a troca como pronta', async () => {
    const gate = new CallGate()
    const leave = await gate.enter(A)
    gate.close(A)
    let drained: boolean | null = null
    const waiting = gate.idle(A, { timeoutMs: 5000 }).then((ok) => (drained = ok))
    await Promise.resolve()
    expect(drained).toBeNull()
    leave()
    await waiting
    expect(drained).toBe(true)
    gate.open(A)
  })

  it('uma chamada antiga de outro repositório (troca forçada) não atrasa a espera de A', async () => {
    const gate = new CallGate()
    await gate.enter(B) // continua em andamento
    await expect(gate.idle(A)).resolves.toBe(true)
    gate.close(A)
    await expect(gate.idle(A, { timeoutMs: 100 })).resolves.toBe(true)
    gate.open(A)
  })

  it('o tempo-limite encerra a espera (troca mesmo assim)', async () => {
    vi.useFakeTimers()
    const gate = new CallGate()
    await gate.enter(A)
    const waiting = gate.idle(A, { timeoutMs: 1000 })
    vi.advanceTimersByTime(1000)
    await expect(waiting).resolves.toBe(false)
  })

  it('o botão "trocar mesmo assim" encerra a espera', async () => {
    const gate = new CallGate()
    await gate.enter(A)
    let force: () => void = () => undefined
    const forced = new Promise<void>((resolve) => (force = resolve))
    const waiting = gate.idle(A, { forced })
    force()
    await expect(waiting).resolves.toBe(false)
  })

  it('sem chamadas em andamento, a espera termina na hora', async () => {
    await expect(new CallGate().idle(A)).resolves.toBe(true)
  })
})
