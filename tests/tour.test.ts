import { describe, expect, it, vi } from 'vitest'
import { setLocale } from '../src/shared/i18n'
import type { TourMessages } from '../src/shared/i18n/messages/tour/types'
import { SCREEN_IDS, SCREEN_VIEWS } from '../src/renderer/src/dock'
import { TOP_SCREEN_IDS } from '../src/renderer/src/screenVisibility'
import {
  TOUR_SEEN_KEY,
  TOUR_STEPS,
  advance,
  buildTourList,
  markSeen,
  parseSeen,
  progressOf,
  restoreTarget,
  settle,
  startTour,
  type TourContext,
  type TourState,
  type TourStep
} from '../src/renderer/src/tour'
import { registerTourTexts, tourT } from '../src/renderer/src/tourText'

const ALL_IDS = TOUR_STEPS.map((s) => s.id)
const REPO: TourContext = { hasRepo: true, hiddenScreens: [] }
const SEM_REPO: TourContext = { hasRepo: false, hiddenScreens: [] }
const INICIAL = { view: 'history', dashboards: true }
const sempre = () => true

/** Avança até o fim do passeio, com o alvo de cada passo conferido por `exists`. */
function percorrer(state: TourState, exists: (s: TourStep) => boolean): TourState {
  let s = state
  for (let i = 0; i < 100 && !s.done; i++) s = advance(s, 1, exists)
  return s
}

describe('lista de passos', () => {
  it('tem os 20 passos na ordem da tabela, cada id uma vez', () => {
    expect(ALL_IDS).toEqual([
      'open',
      'clone',
      'branch',
      'fetch',
      'pull',
      'push',
      'new',
      'studio',
      'conflicts',
      'settings',
      'screens',
      'history',
      'history-diff',
      'changes-commit',
      'changes-diff',
      'files',
      'compare',
      'branches',
      'gitlog',
      'dashboards'
    ])
    expect(new Set(ALL_IDS).size).toBe(20)
  })

  it('cada alvo é um data-tour ou um data-view que existe no dock', () => {
    const views = Object.values(SCREEN_VIEWS).flat()
    for (const step of TOUR_STEPS) {
      const m = /^\[data-(tour|view)="([^"]+)"\]$/.exec(step.target)
      expect(m, step.id).not.toBeNull()
      if (m?.[1] === 'view') expect(views, step.id).toContain(m[2])
    }
  })

  it('só os passos 12 a 19 têm tela a abrir, e ela é uma tela do dock; hideKey é uma tela do topo', () => {
    const comTela = TOUR_STEPS.filter((s) => s.screen !== undefined).map((s) => s.id)
    expect(comTela).toEqual(['history', 'history-diff', 'changes-commit', 'changes-diff', 'files', 'compare', 'branches', 'gitlog'])
    for (const step of TOUR_STEPS.filter((s) => s.screen !== undefined)) expect(SCREEN_IDS).toContain(step.screen)
    for (const step of TOUR_STEPS.filter((s) => s.hideKey !== undefined)) expect(TOP_SCREEN_IDS).toContain(step.hideKey)
  })
})

describe('montagem da lista por contexto e telas ocultas', () => {
  it('sem repositório sobram três passos: abrir, clonar e configurações', () => {
    const { list, hidden } = buildTourList(SEM_REPO)
    expect(list.map((s) => s.id)).toEqual(['open', 'clone', 'settings'])
    expect(hidden).toEqual([])
  })

  it('com repositório sai a tela de abrir e a de clonar; configurações fica', () => {
    const { list, hidden } = buildTourList(REPO)
    expect(list).toHaveLength(18)
    expect(list.map((s) => s.id)).not.toContain('open')
    expect(list.map((s) => s.id)).not.toContain('clone')
    expect(list.map((s) => s.id)).toContain('settings')
    expect(hidden).toEqual([])
  })

  it('tela escondida tira os passos dela e os lista como escondidos', () => {
    const { list, hidden } = buildTourList({ hasRepo: true, hiddenScreens: ['history'] })
    expect(hidden).toEqual(['history', 'history-diff'])
    expect(list.map((s) => s.id)).not.toContain('history')
    expect(list.map((s) => s.id)).toContain('changes-commit')
  })

  it('dashboards escondido tira só o passo 20', () => {
    const { list, hidden } = buildTourList({ hasRepo: true, hiddenScreens: ['dashboards'] })
    expect(hidden).toEqual(['dashboards'])
    expect(list).toHaveLength(17)
  })

  it('com todas as telas escondidas, a faixa de abas some: sai o passo 11 e os das telas', () => {
    const { list, hidden } = buildTourList({ hasRepo: true, hiddenScreens: [...TOP_SCREEN_IDS] })
    expect(hidden).toEqual(['screens', 'history', 'history-diff', 'changes-commit', 'changes-diff', 'files', 'compare', 'branches', 'gitlog', 'dashboards'])
    expect(list.map((s) => s.id)).not.toContain('screens')
    expect(list.map((s) => s.id)).toContain('settings')
  })

  it('sem repositório, tela escondida não mexe na lista (não há faixa de abas)', () => {
    const { list, hidden } = buildTourList({ hasRepo: false, hiddenScreens: [...TOP_SCREEN_IDS] })
    expect(hidden).toEqual([])
    expect(list.map((s) => s.id)).toEqual(['open', 'clone', 'settings'])
  })

  it('valor desconhecido em telas escondidas é ignorado', () => {
    const { list, hidden } = buildTourList({ hasRepo: true, hiddenScreens: ['xyz'] })
    expect(hidden).toEqual([])
    expect(list).toHaveLength(18)
  })
})

describe('começo, avanço, recuo e fim', () => {
  it('começa no primeiro passo ainda não visto', () => {
    const s = startTour(REPO, ['branch', 'fetch'], INICIAL)
    expect(s.list[s.index].id).toBe('pull')
  })

  it('com todos os passos vistos, recomeça do primeiro', () => {
    const s = startTour(REPO, ALL_IDS, INICIAL)
    expect(s.index).toBe(0)
  })

  it('retoma no primeiro não visto mesmo com lacunas antes dele', () => {
    const s = startTour(REPO, ['pull'], INICIAL)
    expect(s.list[s.index].id).toBe('branch')
  })

  it('sem repositório começa na tela de abrir', () => {
    const s = startTour(SEM_REPO, [], INICIAL)
    expect(s.list[s.index].id).toBe('open')
    expect(s.hasRepo).toBe(false)
  })

  it('pula passo sem alvo no avanço e não repete o id em skipped', () => {
    const exists = (s: TourStep) => s.id !== 'pull'
    let s = startTour(REPO, [], INICIAL)
    s = advance(s, 1, exists)
    expect(s.list[s.index].id).toBe('fetch')
    s = advance(s, 1, exists)
    expect(s.list[s.index].id).toBe('push')
    expect(s.skipped).toEqual(['pull'])
    s = advance(s, -1, exists)
    expect(s.list[s.index].id).toBe('fetch')
    s = advance(s, 1, exists)
    expect(s.list[s.index].id).toBe('push')
    expect(s.skipped).toEqual(['pull'])
  })

  it('recuar no primeiro passo não faz nada', () => {
    const s = startTour(REPO, [], INICIAL)
    expect(advance(s, -1, sempre)).toBe(s)
  })

  it('passar do último passo termina o Tour, e depois disso o estado não muda', () => {
    const fim = percorrer(startTour(REPO, [], INICIAL), sempre)
    expect(fim.done).toBe(true)
    expect(progressOf(fim)).toEqual({ current: 18, total: 18 })
    expect(advance(fim, 1, sempre)).toBe(fim)
  })

  it('passos sem alvo no fim entram em skipped na ordem da lista, sem repetição', () => {
    const fim = percorrer(startTour(REPO, [], INICIAL), (s) => s.id !== 'gitlog' && s.id !== 'dashboards')
    expect(fim.done).toBe(true)
    expect(fim.skipped).toEqual(['gitlog', 'dashboards'])
  })

  it('settle com o alvo do passo atual ausente pula para o próximo e registra o pulado', () => {
    const s = startTour(REPO, [], INICIAL)
    const ajustado = settle(s, (step) => step.id !== 'branch')
    expect(ajustado.list[ajustado.index].id).toBe('fetch')
    expect(ajustado.skipped).toEqual(['branch'])
  })

  it('settle com o alvo presente devolve o mesmo estado', () => {
    const s = startTour(REPO, [], INICIAL)
    expect(settle(s, sempre)).toBe(s)
  })

  it('settle sem passo seguinte com alvo termina o Tour', () => {
    const s = startTour(REPO, ALL_IDS.filter((id) => id !== 'dashboards'), INICIAL)
    expect(s.list[s.index].id).toBe('dashboards')
    const fim = settle(s, (step) => step.id !== 'dashboards')
    expect(fim.done).toBe(true)
    expect(fim.skipped).toEqual(['dashboards'])
  })
})

describe('saída devolve a interface ao que era', () => {
  it('restoreTarget devolve o estado inicial no primeiro passo, no meio e depois do fim', () => {
    const inicio = startTour(REPO, [], INICIAL)
    expect(restoreTarget(inicio)).toEqual(INICIAL)
    const meio = advance(advance(inicio, 1, sempre), 1, sempre)
    expect(restoreTarget(meio)).toEqual(INICIAL)
    const fim = percorrer(inicio, sempre)
    expect(restoreTarget(fim)).toEqual(INICIAL)
  })

  it('restoreTarget devolve uma cópia, não o objeto guardado', () => {
    const s = startTour(REPO, [], INICIAL)
    const alvo = restoreTarget(s)
    expect(alvo).not.toBe(s.initial)
    expect(alvo).toEqual(INICIAL)
  })
})

describe('progresso e passos vistos', () => {
  it('progresso conta o passo atual sobre o total da lista', () => {
    expect(progressOf(startTour(REPO, [], INICIAL))).toEqual({ current: 1, total: 18 })
    expect(progressOf(startTour(SEM_REPO, [], INICIAL))).toEqual({ current: 1, total: 3 })
  })

  it('a chave de progresso é tour.seen (prefixo pref. fica por conta de layout.ts)', () => {
    expect(TOUR_SEEN_KEY).toBe('tour.seen')
  })

  it('parseSeen aceita lista ou o JSON dela, só ids conhecidos e sem repetição', () => {
    expect(parseSeen(['branch', 'pull'])).toEqual(['branch', 'pull'])
    expect(parseSeen('["branch","pull"]')).toEqual(['branch', 'pull'])
    expect(parseSeen(['branch', 'xyz', 3, 'branch', null, 'pull'])).toEqual(['branch', 'pull'])
  })

  it('parseSeen com lixo devolve lista vazia', () => {
    expect(parseSeen('não é json')).toEqual([])
    expect(parseSeen('{"a":1}')).toEqual([])
    expect(parseSeen(null)).toEqual([])
    expect(parseSeen(42)).toEqual([])
    expect(parseSeen({})).toEqual([])
    expect(parseSeen(undefined)).toEqual([])
  })

  it('markSeen acrescenta sem repetir e não altera a lista recebida', () => {
    const antes = ['branch']
    expect(markSeen(antes, 'pull')).toEqual(['branch', 'pull'])
    expect(markSeen(['branch'], 'branch')).toEqual(['branch'])
    expect(antes).toEqual(['branch'])
  })
})

/** Textos completos de um idioma de teste; cada valor leva o prefixo, para o teste dizer de onde veio. */
function textos(p: string): TourMessages {
  return {
    step: {
      open: `${p}open`,
      clone: `${p}clone`,
      branch: `${p}branch`,
      fetch: `${p}fetch`,
      pull: `${p}pull`,
      push: `${p}push`,
      new: `${p}new`,
      studio: `${p}studio`,
      conflicts: `${p}conflicts`,
      settings: `${p}settings`,
      screens: `${p}screens`,
      history: `${p}history`,
      'history-diff': `${p}history-diff`,
      'changes-commit': `${p}changes-commit`,
      'changes-diff': `${p}changes-diff`,
      files: `${p}files`,
      compare: `${p}compare`,
      branches: `${p}branches`,
      gitlog: `${p}gitlog`,
      dashboards: `${p}dashboards`
    },
    card: {
      previous: `${p}previous`,
      next: `${p}next`,
      exit: `${p}exit`,
      finish: `${p}finish`,
      progress: '{current} de {total}',
      skippedTitle: `${p}skippedTitle`,
      noRepoEnd: `${p}noRepoEnd`,
      hiddenTitle: `${p}hiddenTitle`,
      title: `${p}title`
    }
  }
}

describe('tourT: texto no idioma atual, com fallback e parâmetros', () => {
  it('usa o idioma atual e troca {nome} pelos parâmetros', () => {
    expect(setLocale('pt-BR')).toBe(true)
    registerTourTexts('pt-BR', textos('PT '))
    expect(tourT('step.branch')).toBe('PT branch')
    expect(tourT('card.progress', { current: 3, total: 18 })).toBe('3 de 18')
  })

  it('sem texto no idioma atual, cai no inglês', () => {
    expect(setLocale('es')).toBe(true)
    registerTourTexts('en', textos('EN '))
    expect(tourT('card.next')).toBe('EN next')
  })

  it('sem texto carregado em nenhum idioma, devolve a própria chave', async () => {
    vi.resetModules()
    const fresco = await import('../src/renderer/src/tourText')
    expect(fresco.tourT('card.next')).toBe('card.next')
    expect(fresco.tourT('step.open')).toBe('step.open')
  })

  it('parâmetro sem valor fica como está no texto', () => {
    expect(tourT('card.progress')).toBe('{current} de {total}')
    expect(tourT('card.progress', { current: 1 })).toBe('1 de {total}')
  })
})
