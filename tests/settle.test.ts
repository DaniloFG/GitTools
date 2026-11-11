import { describe, expect, it } from 'vitest'
import { settleDelay } from '../src/renderer/src/settle'

// Valores de CommitPanes: 400 ms de silêncio para ser isolada, 120 ms de espera numa rajada.
const QUIET = 400
const WAIT = 120

describe('espera antes de aplicar a seleção do histórico', () => {
  it('primeira mudança de todas (sem anterior) vale na hora', () => {
    expect(settleDelay(1000, undefined, QUIET, WAIT)).toBe(0)
  })

  it('mudança isolada, há mais tempo que quietMs, vale na hora', () => {
    expect(settleDelay(1000, 500, QUIET, WAIT)).toBe(0)
  })

  it('rajada com intervalo menor que waitMs espera waitMs', () => {
    expect(settleDelay(1000, 990, QUIET, WAIT)).toBe(WAIT)
  })

  it('rajada com intervalo entre waitMs e quietMs espera waitMs (máquina lenta: não pode virar isolada)', () => {
    // Intervalo de 150 ms: maior que waitMs (120) e menor que quietMs (400).
    expect(settleDelay(1000, 850, QUIET, WAIT)).toBe(WAIT)
  })

  it('exatamente no limite de quietMs conta como rajada', () => {
    expect(settleDelay(1000, 600, QUIET, WAIT)).toBe(WAIT)
  })

  it('um instante depois do limite de quietMs já vale na hora', () => {
    expect(settleDelay(1000, 599, QUIET, WAIT)).toBe(0)
  })
})
