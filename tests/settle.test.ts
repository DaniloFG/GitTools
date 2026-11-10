import { describe, expect, it } from 'vitest'
import { settleDelay } from '../src/renderer/src/settle'

describe('espera antes de aplicar a seleção do histórico', () => {
  it('primeira mudança de todas (sem anterior) vale na hora', () => {
    expect(settleDelay(1000, undefined, 100)).toBe(0)
  })

  it('mudança isolada, há mais tempo que o intervalo, vale na hora', () => {
    expect(settleDelay(1000, 500, 100)).toBe(0)
  })

  it('mudança logo depois de outra espera o intervalo (rajada)', () => {
    expect(settleDelay(1000, 950, 100)).toBe(100)
  })

  it('exatamente no limite conta como rajada', () => {
    expect(settleDelay(1000, 900, 100)).toBe(100)
  })

  it('um instante depois do limite já vale na hora', () => {
    expect(settleDelay(1000, 899, 100)).toBe(0)
  })
})
