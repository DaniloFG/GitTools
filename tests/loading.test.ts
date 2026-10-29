import { describe, expect, it } from 'vitest'
import { IDLE_LOADING, LOADING_TIMING, planLoading, type LoadingMemory } from '../src/renderer/src/loading'

/** Roda uma sequência de (ativo?, instante) e devolve o plano de cada passo, passando a memória de um para o outro. */
function run(steps: [boolean, number][]) {
  let memory: LoadingMemory = IDLE_LOADING
  return steps.map(([active, now]) => {
    const plan = planLoading(active, memory, now)
    memory = { startedAt: plan.startedAt, shownAt: plan.shownAt }
    return plan
  })
}

describe('indicador de carregamento (atraso e tempo mínimo)', () => {
  it('usa 150 ms de atraso e 300 ms de permanência mínima', () => {
    expect(LOADING_TIMING).toEqual({ delayMs: 150, minMs: 300 })
  })

  it('não aparece para operações mais rápidas que o atraso (sem piscar)', () => {
    const [start, mid, end, later] = run([
      [true, 1000],
      [true, 1100],
      [false, 1120],
      [false, 2000]
    ])
    expect(start).toMatchObject({ visible: false, wakeIn: 150, startedAt: 1000, shownAt: null })
    expect(mid).toMatchObject({ visible: false, wakeIn: 50 })
    expect(end).toMatchObject({ visible: false, wakeIn: null, startedAt: null, shownAt: null })
    expect(later.visible).toBe(false)
  })

  it('aparece assim que o atraso passa, mesmo que a operação ainda esteja rodando', () => {
    const [, due, still] = run([
      [true, 0],
      [true, 150],
      [true, 900]
    ])
    expect(due).toMatchObject({ visible: true, shownAt: 150, wakeIn: null })
    expect(still).toMatchObject({ visible: true, shownAt: 150 })
  })

  it('fica na tela pelo menos 300 ms depois de aparecer', () => {
    const [, , done, almost, gone] = run([
      [true, 0],
      [true, 200],
      [false, 400],
      [false, 499],
      [false, 500]
    ])
    // apareceu em 200: o mínimo vai até 500
    expect(done).toMatchObject({ visible: true, shownAt: 200, wakeIn: 100 })
    expect(almost).toMatchObject({ visible: true, wakeIn: 1 })
    expect(gone).toMatchObject({ visible: false, shownAt: null, wakeIn: null })
  })

  it('não some antes do mínimo mesmo que a operação termine logo depois de aparecer', () => {
    const [, shown, ended] = run([
      [true, 0],
      [true, 150],
      [false, 151]
    ])
    expect(shown.visible).toBe(true)
    expect(ended).toMatchObject({ visible: true, shownAt: 150, wakeIn: 299 })
  })

  it('operação nova logo após uma anterior: o indicador continua na tela sem reiniciar o atraso', () => {
    const [, , , reopened] = run([
      [true, 0],
      [true, 200],
      [false, 260],
      [true, 300]
    ])
    expect(reopened).toMatchObject({ visible: true, shownAt: 200, startedAt: null, wakeIn: null })
  })

  it('respeita tempos personalizados', () => {
    const plan = planLoading(true, IDLE_LOADING, 10, { delayMs: 0, minMs: 1000 })
    expect(plan).toMatchObject({ visible: true, shownAt: 10 })
    const after = planLoading(false, { startedAt: null, shownAt: 10 }, 900, { delayMs: 0, minMs: 1000 })
    expect(after).toMatchObject({ visible: true, wakeIn: 110 })
  })

  it('sem operação e sem memória, nada aparece e não há nada a agendar', () => {
    expect(planLoading(false, IDLE_LOADING, 5000)).toEqual({ startedAt: null, shownAt: null, visible: false, wakeIn: null })
  })
})
