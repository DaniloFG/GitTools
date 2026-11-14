import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// A skill `pr` precisa manter o acompanhamento de 10 minutos e o critério de parada (issue #188).
const texto = readFileSync('.claude/skills/pr/SKILL.md', 'utf8')

describe('skill pr: acompanhamento de PR em espera', () => {
  it('agenda a conferência a cada 10 minutos com send_later', () => {
    expect(texto).toMatch(/send_later[^\n]*delay_minutes: 10/)
  })
  it('para no fim do PR ou após 3 verificações vazias', () => {
    expect(texto).toMatch(/3\s+verificações vazias/)
    expect(texto).toMatch(/fecha ou é mergeado/)
  })
})
