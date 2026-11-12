import { describe, expect, it } from 'vitest'
import { placePopover } from '../src/renderer/src/analytics/popoverPlacement'

// Medidas do `.dash-popover` (280 × 340), com o espaço de 6 px e a margem de 8 px usados no componente.
const GAP = 6
const MARGIN = 8
const SIZE = { width: 280, maxHeight: 340 }

/** Botão de 24 px de altura e 100 px de largura, com o topo na posição dada. */
function anchorAt(top: number, left: number, width = 100, height = 24) {
  return { top, bottom: top + height, left, right: left + width }
}

function place(anchor: ReturnType<typeof anchorAt>, viewport: { width: number; height: number }) {
  return placePopover({ anchor, size: SIZE, viewport, gap: GAP, margin: MARGIN })
}

describe('placePopover: altura (abrir para baixo ou para cima)', () => {
  it('cabe embaixo: abre para baixo com a altura desejada', () => {
    const r = place(anchorAt(100, 500), { width: 1000, height: 800 })
    expect(r).toEqual({ openUp: false, alignEnd: false, maxHeight: 340 })
  })

  it('perto da borda inferior, com mais espaço em cima: abre para cima', () => {
    // Embaixo sobram 62 px (500 - 424 - 6 - 8); em cima, 386 px (400 - 6 - 8).
    const r = place(anchorAt(400, 500), { width: 1000, height: 500 })
    expect(r).toEqual({ openUp: true, alignEnd: false, maxHeight: 340 })
  })

  it('limite: embaixo com exatamente a altura desejada ainda abre para baixo', () => {
    // Embaixo sobram 340 px (754 - 400 - 6 - 8).
    const r = place(anchorAt(376, 500), { width: 1000, height: 754 })
    expect(r.openUp).toBe(false)
    expect(r.maxHeight).toBe(340)
  })

  it('limite + 1: embaixo sobram 339 px, e em cima há mais (362 px), então sobe', () => {
    // Embaixo: 753 - 400 - 6 - 8 = 339. Em cima: 376 - 6 - 8 = 362.
    const r = place(anchorAt(376, 500), { width: 1000, height: 753 })
    expect(r.openUp).toBe(true)
    expect(r.maxHeight).toBe(340)
  })

  it('espaço igual dos dois lados: desempate para baixo', () => {
    // Embaixo: 424 - 224 - 6 - 8 = 186. Em cima: 200 - 6 - 8 = 186.
    const r = place(anchorAt(200, 500), { width: 1000, height: 424 })
    expect(r.openUp).toBe(false)
    expect(r.maxHeight).toBe(186)
  })

  it('viewport pequeno: a altura é reduzida ao espaço do lado escolhido', () => {
    // Viewport 400 × 300: embaixo sobram 112 px; em cima, 136 px. Sobe com 136 px.
    const r = place(anchorAt(150, 20), { width: 400, height: 300 })
    expect(r.openUp).toBe(true)
    expect(r.maxHeight).toBe(136)
    expect(r.maxHeight).toBeLessThan(SIZE.maxHeight)
  })

  it('espaço de exatamente 120 px no lado escolhido: a altura é 120', () => {
    // Embaixo: 258 - 124 - 6 - 8 = 120. Em cima: 100 - 6 - 8 = 86, então fica embaixo.
    const r = place(anchorAt(100, 20), { width: 400, height: 258 })
    expect(r.openUp).toBe(false)
    expect(r.maxHeight).toBe(120)
  })

  it('espaço de 119 px no lado escolhido: a altura é 119 (não passa da borda)', () => {
    // Embaixo: 257 - 124 - 6 - 8 = 119. Em cima: 86. Fica embaixo.
    const r = place(anchorAt(100, 20), { width: 400, height: 257 })
    expect(r.openUp).toBe(false)
    expect(r.maxHeight).toBe(119)
  })

  it('pouco espaço nos dois lados: devolve o espaço que há, sem passar da borda', () => {
    // Viewport 300 × 200: embaixo sobram 82 px; em cima, 66 px. Fica embaixo com 82 px.
    const r = place(anchorAt(80, 20), { width: 300, height: 200 })
    expect(r.openUp).toBe(false)
    expect(r.maxHeight).toBe(82)
  })

  it('âncora no fim da tela (sem espaço embaixo): abre para cima, sem altura negativa', () => {
    const r = place(anchorAt(590, 20), { width: 800, height: 600 })
    expect(r).toEqual({ openUp: true, alignEnd: false, maxHeight: 340 })
  })
})

describe('placePopover: alinhamento na borda direita', () => {
  it('cabe alinhado ao início: não muda o alinhamento', () => {
    const r = place(anchorAt(100, 200), { width: 800, height: 600 })
    expect(r.alignEnd).toBe(false)
  })

  it('limite: início + largura exatamente na margem da direita ainda não alinha ao fim', () => {
    // 512 + 280 = 792 = 800 - 8.
    const r = place(anchorAt(100, 512), { width: 800, height: 600 })
    expect(r.alignEnd).toBe(false)
  })

  it('limite + 1: passa da borda direita e cabe alinhando ao fim', () => {
    // 513 + 280 = 793 > 792. Fim da âncora: 613; 613 - 280 = 333 ≥ 8.
    const r = place(anchorAt(100, 513), { width: 800, height: 600 })
    expect(r.alignEnd).toBe(true)
  })

  it('passa da borda direita mas não cabe alinhando ao fim: mantém o início', () => {
    // 20 + 280 = 300 > 242 (viewport 250 - 8). Fim da âncora: 120; 120 - 280 < 8.
    const r = place(anchorAt(100, 20), { width: 250, height: 600 })
    expect(r.alignEnd).toBe(false)
  })

  it('âncora no canto inferior direito: alinha ao fim e abre para cima', () => {
    const r = place(anchorAt(570, 700, 90), { width: 800, height: 600 })
    expect(r).toEqual({ openUp: true, alignEnd: true, maxHeight: 340 })
  })

  it('âncora no canto superior esquerdo: abre para baixo, alinhado ao início', () => {
    const r = place(anchorAt(0, 0), { width: 800, height: 600 })
    expect(r).toEqual({ openUp: false, alignEnd: false, maxHeight: 340 })
  })
})
