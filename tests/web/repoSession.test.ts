import { afterEach, describe, expect, it } from 'vitest'
import {
  clearSessions,
  covers,
  dropSession,
  getSession,
  peekSession,
  planFor,
  sessionState,
  trimSessions,
  type Loaded,
  type StateInput
} from '../../src/renderer/src/repoSession'

afterEach(() => clearSessions())

const loaded = (over: Partial<Loaded> = {}): Loaded => ({ generation: 5, scopeKey: 'all', log: true, stashes: false, ...over })
const input = (over: Partial<StateInput> = {}): StateInput => ({
  hasData: true,
  loaded: loaded(),
  loading: false,
  generation: 5,
  scopeKey: 'all',
  wants: { log: true, stashes: false },
  ...over
})

describe('máquina de estados da sessão', () => {
  it('sem dados é cold; lendo pela primeira vez é loading', () => {
    expect(sessionState(input({ hasData: false, loaded: null }))).toBe('cold')
    expect(sessionState(input({ hasData: false, loaded: null, loading: true }))).toBe('loading')
  })

  it('geração igual e dados que cobrem a tela: fresh (voltar à aba não chama o git)', () => {
    expect(sessionState(input())).toBe('fresh')
    expect(planFor('fresh')).toBe('use-cached')
  })

  it('a geração subiu (algo mudou no repositório): stale, e a aba aparece com o dado antigo enquanto relê', () => {
    expect(sessionState(input({ generation: 6 }))).toBe('stale')
    expect(planFor('stale')).toBe('revalidate')
  })

  it('lendo de novo com dados na tela é revalidating, e não começa outra leitura', () => {
    expect(sessionState(input({ generation: 6, loading: true }))).toBe('revalidating')
    expect(planFor('revalidating')).toBe('wait')
    expect(planFor('loading')).toBe('wait')
  })

  it('cold manda carregar com o indicador de carregamento', () => {
    expect(planFor('cold')).toBe('load')
  })

  it('o dado que não trouxe o histórico fica stale quando a tela passa a mostrá-lo', () => {
    const noLog = loaded({ log: false })
    expect(sessionState(input({ loaded: noLog, wants: { log: false, stashes: false } }))).toBe('fresh')
    expect(sessionState(input({ loaded: noLog, wants: { log: true, stashes: false } }))).toBe('stale')
  })

  it('o mesmo vale para os stashes e para o filtro de branches do histórico', () => {
    expect(sessionState(input({ wants: { log: true, stashes: true } }))).toBe('stale')
    expect(sessionState(input({ loaded: loaded({ stashes: true }), wants: { log: false, stashes: true } }))).toBe('fresh')
    expect(sessionState(input({ scopeKey: 'head' }))).toBe('stale')
  })

  it('dado que trouxe mais do que a tela quer continua valendo', () => {
    expect(covers(loaded({ log: true, stashes: true }), 'all', { log: false, stashes: false })).toBe(true)
  })
})

describe('sessões por repositório', () => {
  it('cada repositório tem a sua sessão, com a sua tela, e ela volta igual', () => {
    const a = getSession('/a')
    const b = getSession('/b')
    a.ui.selected = ['abc']
    a.ui.scope = { kind: 'head' }
    a.ui.panes.set('changes.active', { path: 'x.txt' })
    expect(getSession('/a')).toBe(a)
    expect(getSession('/a').ui.selected).toEqual(['abc'])
    expect(b.ui.selected).toEqual([])
    expect(b.ui.scope).toEqual({ kind: 'all' })
    expect(b.ui.panes.size).toBe(0)
  })

  it('as sessões não compartilham estado entre si (nem o objeto de painéis)', () => {
    expect(getSession('/a').ui.panes).not.toBe(getSession('/b').ui.panes)
    expect(getSession('/a').ui.compare).not.toBe(getSession('/b').ui.compare)
  })

  it('fechar o repositório descarta a sessão; reabrir começa do zero', () => {
    getSession('/a').ui.selected = ['x']
    dropSession('/a')
    expect(peekSession('/a')).toBeUndefined()
    expect(getSession('/a').ui.selected).toEqual([])
  })

  it('limita quantas sessões guardam dados: as menos usadas esfriam e mantêm a tela', () => {
    for (let n = 0; n < 5; n++) {
      const s = getSession(`/r${n}`)
      s.data = {} as never
      s.loaded = loaded()
      s.touchedAt = n // /r0 é a mais antiga
      s.ui.selected = [`sel${n}`]
    }
    const dropped = trimSessions('/r4', 3)
    expect(dropped.sort()).toEqual(['/r0', '/r1'])
    expect(peekSession('/r0')!.data).toBeNull()
    expect(peekSession('/r0')!.loaded).toBeNull()
    expect(peekSession('/r0')!.ui.selected).toEqual(['sel0'])
    expect(peekSession('/r4')!.data).not.toBeNull()
    expect(peekSession('/r3')!.data).not.toBeNull()
  })

  it('nunca esfria a sessão ativa nem uma que está lendo', () => {
    for (let n = 0; n < 4; n++) {
      const s = getSession(`/r${n}`)
      s.data = {} as never
      s.touchedAt = n
    }
    peekSession('/r0')!.inflight = Promise.resolve()
    trimSessions('/r1', 2)
    expect(peekSession('/r0')!.data).not.toBeNull() // lendo
    expect(peekSession('/r1')!.data).not.toBeNull() // ativa
  })

  it('não faz nada abaixo do limite', () => {
    getSession('/a').data = {} as never
    expect(trimSessions('/a', 3)).toEqual([])
  })
})
