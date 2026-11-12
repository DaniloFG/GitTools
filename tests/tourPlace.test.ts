import { describe, expect, it } from 'vitest'
import { GAP, MARGIN, placeCard, type Box } from '../src/renderer/src/tour'

/** Retângulo do cartão na posição devolvida por `placeCard`. */
function cardBox(at: { left: number; top: number }, card: { width: number; height: number }): Box {
  return { left: at.left, top: at.top, width: card.width, height: card.height }
}

/** Dois retângulos se cruzam por área (encostar na borda não conta). */
function sobrepoe(a: Box, b: Box): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height
}

describe('placeCard', () => {
  it('escolhe o lado com mais espaço entre os que comportam o cartão', () => {
    // Alvo perto da direita: espaço à esquerda (800) é o maior; à direita (100) não comporta o cartão.
    const view = { width: 1000, height: 600 }
    const target: Box = { left: 800, top: 200, width: 100, height: 50 }
    const card = { width: 150, height: 100 }
    // above 200, below 350, before 800, after 100: só before, above e below comportam; before ganha.
    expect(placeCard(target, card, view)).toEqual({ left: 800 - GAP - 150, top: 175 })
  })

  it('entre os lados que comportam, o de mais espaço ganha (abaixo, 800, contra 400 à esquerda e à direita)', () => {
    const view = { width: 1000, height: 1000 }
    const target: Box = { left: 400, top: 100, width: 200, height: 100 }
    const card = { width: 200, height: 100 }
    // above 100 (não comporta 120), below 800, before 400, after 400: abaixo ganha.
    expect(placeCard(target, card, view)).toEqual({ left: 400, top: 200 + GAP })
  })

  it('nunca cobre o alvo, em toda posição de um alvo pequeno numa janela', () => {
    const view = { width: 800, height: 600 }
    const card = { width: 200, height: 120 }
    const alvo = { width: 40, height: 20 }
    for (let left = 0; left <= view.width - alvo.width; left += 40) {
      for (let top = 0; top <= view.height - alvo.height; top += 30) {
        const target: Box = { left, top, ...alvo }
        const at = placeCard(target, card, view)
        expect(sobrepoe(cardBox(at, card), target), `alvo em ${left},${top}`).toBe(false)
      }
    }
  })

  it('nunca sai da janela: left e top >= MARGIN, e o cartão cabe até a borda, em toda posição', () => {
    const view = { width: 800, height: 600 }
    const card = { width: 200, height: 120 }
    const alvo = { width: 40, height: 20 }
    for (let left = 0; left <= view.width - alvo.width; left += 40) {
      for (let top = 0; top <= view.height - alvo.height; top += 30) {
        const at = placeCard({ left, top, ...alvo }, card, view)
        expect(at.left, `alvo em ${left},${top}`).toBeGreaterThanOrEqual(MARGIN)
        expect(at.top, `alvo em ${left},${top}`).toBeGreaterThanOrEqual(MARGIN)
        expect(at.left + card.width, `alvo em ${left},${top}`).toBeLessThanOrEqual(view.width)
        expect(at.top + card.height, `alvo em ${left},${top}`).toBeLessThanOrEqual(view.height)
      }
    }
  })

  it('alvo enorme (cobre a janela toda) cai no canto de baixo, com a margem', () => {
    const view = { width: 800, height: 600 }
    const card = { width: 300, height: 200 }
    const target: Box = { left: 0, top: 0, width: 1000, height: 1000 }
    expect(placeCard(target, card, view)).toEqual({ left: 800 - 300 - MARGIN, top: 600 - 200 - MARGIN })
  })

  it('janela estreita (320x600) com alvo no topo põe o cartão abaixo do alvo', () => {
    const view = { width: 320, height: 600 }
    const card = { width: 280, height: 150 }
    const target: Box = { left: 100, top: 10, width: 120, height: 30 }
    // acima 10 (não comporta), antes 100 e depois 100 (não comportam 280 + folga); abaixo 560 comporta.
    const at = placeCard(target, card, view)
    expect(at.top).toBe(target.top + target.height + GAP)
    expect(at.left).toBeGreaterThanOrEqual(MARGIN)
    expect(at.left + card.width).toBeLessThanOrEqual(view.width)
  })
})
