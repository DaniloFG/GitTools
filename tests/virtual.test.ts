import { describe, expect, it } from 'vitest'
import { anchoredScrollTop, buildOffsets, indexAt, nextRange, sameRange, scrollToReveal, visibleRange, type RowRange } from '../src/renderer/src/virtual'

describe('buildOffsets', () => {
  it('altura fixa: posição de cada item e total no último índice', () => {
    const o = buildOffsets(3, 30)
    expect(Array.from(o)).toEqual([0, 30, 60, 90])
  })

  it('exceções de altura são somadas no lugar do padrão; undefined vale o padrão', () => {
    const o = buildOffsets(4, 30, (i) => (i === 1 ? 100 : undefined))
    expect(Array.from(o)).toEqual([0, 30, 130, 160, 190])
  })

  it('lista vazia tem só o zero', () => {
    expect(Array.from(buildOffsets(0, 30))).toEqual([0])
  })

  it('contagem inválida vira lista vazia, sem estourar a alocação', () => {
    expect(Array.from(buildOffsets(Number.NaN, 30))).toEqual([0])
  })

  it('20.000 itens levam menos de 20 ms (é linear, roda a cada mudança de dados)', () => {
    const t0 = performance.now()
    const o = buildOffsets(20_000, 30, (i) => (i % 7 === 0 ? 90 : undefined))
    const ms = performance.now() - t0
    expect(o[20_000]).toBeGreaterThan(0)
    expect(ms).toBeLessThan(20)
  })
})

describe('indexAt', () => {
  const o = buildOffsets(3, 30) // [0, 30, 60, 90]

  it('fronteiras exatas pertencem ao item que começa ali', () => {
    expect(indexAt(o, 0)).toBe(0)
    expect(indexAt(o, 30)).toBe(1)
    expect(indexAt(o, 60)).toBe(2)
  })

  it('posições dentro de um item', () => {
    expect(indexAt(o, 29)).toBe(0)
    expect(indexAt(o, 59)).toBe(1)
    expect(indexAt(o, 89)).toBe(2)
  })

  it('y negativo vira o primeiro item', () => {
    expect(indexAt(o, -5)).toBe(0)
  })

  it('y além do total vira o último item', () => {
    expect(indexAt(o, 90)).toBe(2)
    expect(indexAt(o, 1000)).toBe(2)
  })

  it('lista vazia devolve -1', () => {
    expect(indexAt(buildOffsets(0, 30), 10)).toBe(-1)
  })

  it('item de altura zero não rouba a posição do vizinho', () => {
    // item 0 tem altura zero; o item 1 ocupa [0, 30)
    const z = buildOffsets(2, 30, (i) => (i === 0 ? 0 : undefined))
    expect(indexAt(z, 0)).toBe(1)
  })

  it('itens variáveis grandes', () => {
    const v = buildOffsets(3, 30, (i) => (i === 0 ? 100 : undefined)) // [0, 100, 130, 160]
    expect(indexAt(v, 99)).toBe(0)
    expect(indexAt(v, 100)).toBe(1)
  })
})

describe('visibleRange', () => {
  const o = buildOffsets(10, 30) // total 300

  it('topo da lista', () => {
    expect(visibleRange(o, 0, 60, 0)).toEqual({ start: 0, end: 2 })
  })

  it('meio da lista: itens que cruzam a área, com o último de fora excluído', () => {
    // área [150, 210): itens 5 (150-180) e 6 (180-210)
    expect(visibleRange(o, 150, 60, 0)).toEqual({ start: 5, end: 7 })
  })

  it('margem (overscan) aumenta a faixa dos dois lados', () => {
    // área [120, 240): itens 4 (120-150) até 7 (210-240)
    expect(visibleRange(o, 120 + 30, 60, 30)).toEqual({ start: 4, end: 8 })
  })

  it('fim da lista, com área além do total', () => {
    expect(visibleRange(o, 270, 100, 0)).toEqual({ start: 9, end: 10 })
  })

  it('margem maior que a lista cobre tudo', () => {
    expect(visibleRange(o, 0, 10, 600)).toEqual({ start: 0, end: 10 })
  })

  it('lista vazia', () => {
    expect(visibleRange(buildOffsets(0, 30), 0, 500, 600)).toEqual({ start: 0, end: 0 })
  })

  it('item variável muito grande ocupa a faixa inteira sozinho', () => {
    // [0, 30, 1030, 1060, 1090]: item 1 tem 1000 px
    const v = buildOffsets(4, 30, (i) => (i === 1 ? 1000 : undefined))
    expect(visibleRange(v, 500, 100, 0)).toEqual({ start: 1, end: 2 })
  })
})

describe('scrollToReveal', () => {
  const o = buildOffsets(10, 30) // item i em [30i, 30i + 30)

  it('item já inteiro à vista devolve null', () => {
    expect(scrollToReveal(o, 3, 0, 300, 0)).toBeNull()
  })

  it('item acima da área alinha o topo dele', () => {
    expect(scrollToReveal(o, 2, 300, 300, 0)).toBe(60)
  })

  it('item abaixo da área alinha o fim dele', () => {
    // item 5 em [150, 180); área [0, 150) -> rolar até 180 - 150
    expect(scrollToReveal(o, 5, 0, 150, 0)).toBe(30)
  })

  it('insetTop: a linha sticky do topo não conta como área visível', () => {
    // área com sticky: [200 + 30, 200 + 300); item 5 em [150, 180) está acima
    expect(scrollToReveal(o, 5, 200, 300, 0, 30)).toBe(120)
  })

  it('insetTop: não rola para trás do início', () => {
    // item 1 em [30, 60); sticky de 60 px cobre o item todo: alinhar ao topo daria -30
    expect(scrollToReveal(o, 1, 0, 300, 0, 60)).toBe(0)
  })

  it('base: distância do cabeçalho antes da lista é contada', () => {
    // item 8 começa em 100 + 240 = 340 e termina em 370; área [0, 300) -> 370 - 300
    expect(scrollToReveal(o, 8, 0, 300, 100)).toBe(70)
    // item 0 começa em 100, acima de scrollTop 200
    expect(scrollToReveal(o, 0, 200, 300, 100)).toBe(100)
  })

  it('item mais alto que a área alinha o topo, mesmo vindo de baixo', () => {
    const tall = buildOffsets(3, 30, (i) => (i === 2 ? 500 : undefined)) // item 2 em [60, 560)
    expect(scrollToReveal(tall, 2, 0, 200, 0)).toBe(60)
  })

  it('item mais alto que a área alinha o topo, mesmo vindo de cima', () => {
    const tall = buildOffsets(3, 30, (i) => (i === 1 ? 500 : undefined)) // item 1 em [30, 530)
    expect(scrollToReveal(tall, 1, 400, 200, 0)).toBe(30)
  })

  it('índice fora da lista devolve null', () => {
    expect(scrollToReveal(o, 10, 0, 300, 0)).toBeNull()
    expect(scrollToReveal(o, -1, 0, 300, 0)).toBeNull()
  })
})

describe('nextRange (folga na faixa)', () => {
  const o = buildOffsets(1000, 30) // total 30.000 px
  const HEIGHT = 300
  const OVERSCAN = 600

  it('rolagem de 1 px em 1 px por 3000 px muda a faixa perto de overscan/2 em overscan/2, não a cada item', () => {
    let cur: RowRange = visibleRange(o, 0, HEIGHT, OVERSCAN)
    let changes = 0
    for (let top = 1; top <= 3000; top++) {
      const next = nextRange(o, cur, top, HEIGHT, OVERSCAN)
      if (next !== cur) changes++
      cur = next
    }
    // 3000 / (overscan / 2) = 10; sem folga seriam ~100 trocas (uma a cada 30 px).
    expect(changes).toBeGreaterThanOrEqual(8)
    expect(changes).toBeLessThanOrEqual(12)
  })

  it('devolve a mesma referência enquanto a faixa ainda cobre a área com a metade da margem', () => {
    const cur = visibleRange(o, 1000, HEIGHT, OVERSCAN)
    expect(nextRange(o, cur, 1000, HEIGHT, OVERSCAN)).toBe(cur)
    expect(nextRange(o, cur, 1000 + 100, HEIGHT, OVERSCAN)).toBe(cur)
  })

  it('quando deixa de cobrir, calcula a faixa nova com a margem inteira', () => {
    const cur = visibleRange(o, 1000, HEIGHT, OVERSCAN)
    const top = 1000 + OVERSCAN / 2 + 60 // já passou da folga
    const next = nextRange(o, cur, top, HEIGHT, OVERSCAN)
    expect(next).not.toBe(cur)
    expect(next).toEqual(visibleRange(o, top, HEIGHT, OVERSCAN))
  })

  it('lista que encolheu: faixa que passa do fim é recalculada com a margem inteira', () => {
    const big = visibleRange(o, 20_000, HEIGHT, OVERSCAN)
    const small = buildOffsets(100, 30) // total 3.000 px
    const next = nextRange(small, big, 2000, HEIGHT, OVERSCAN)
    expect(next.end).toBeLessThanOrEqual(100)
    expect(next).toEqual(visibleRange(small, 2000, HEIGHT, OVERSCAN))
  })

  it('altura medida muda as posições: faixa que não cobre mais é recalculada', () => {
    const cur = visibleRange(o, 1000, HEIGHT, OVERSCAN)
    // item 0 passa a ter 30.000 px: os itens da faixa atual ficam muito abaixo da área
    const taller = buildOffsets(1000, 30, (i) => (i === 0 ? 30_000 : undefined))
    const next = nextRange(taller, cur, 1000, HEIGHT, OVERSCAN)
    expect(next).not.toBe(cur)
    expect(next).toEqual(visibleRange(taller, 1000, HEIGHT, OVERSCAN))
  })

  it('lista vazia', () => {
    const empty = buildOffsets(0, 30)
    expect(nextRange(empty, { start: 0, end: 0 }, 0, HEIGHT, OVERSCAN)).toEqual({ start: 0, end: 0 })
    expect(nextRange(empty, { start: 3, end: 9 }, 0, HEIGHT, OVERSCAN)).toEqual({ start: 0, end: 0 })
  })
})

describe('sameRange', () => {
  it('compara início e fim', () => {
    expect(sameRange({ start: 1, end: 4 }, { start: 1, end: 4 })).toBe(true)
    expect(sameRange({ start: 1, end: 4 }, { start: 1, end: 5 })).toBe(false)
  })
})

describe('anchoredScrollTop', () => {
  // Cinco itens de 100 px: [0, 100, 200, 300, 400, 500].
  const prev = buildOffsets(5, 100)
  const heights = (...h: number[]) => buildOffsets(h.length, 100, (i) => h[i])

  it('topo em 0 não ancora: continua em 0 mesmo com alturas diferentes', () => {
    expect(anchoredScrollTop(prev, heights(300, 100, 100, 100, 100), 0, 0)).toBe(0)
  })

  it('offsets idênticos mantêm a rolagem', () => {
    expect(anchoredScrollTop(prev, buildOffsets(5, 100), 250, 0)).toBe(250)
  })

  it('meio de um item: o item do topo e o deslocamento dentro dele ficam no lugar', () => {
    // topo no item 2 (começa em 200), 50 px dentro; itens acima ganham 50 px cada: o item 2 passa a começar em 300.
    expect(anchoredScrollTop(prev, heights(150, 150, 100, 100, 100), 250, 0)).toBe(350)
  })

  it('alturas menores acima: a rolagem diminui junto', () => {
    expect(anchoredScrollTop(prev, heights(50, 50, 100, 100, 100), 250, 0)).toBe(150)
  })

  it('o próprio item do topo muda de altura: mantém a mesma fração dele', () => {
    // 50 px dentro de um item de 100 (metade); ele passa a ter 300 px: metade = 150 px dentro.
    expect(anchoredScrollTop(prev, heights(100, 300, 100, 100, 100), 150, 0)).toBe(100 + 150)
  })

  it('base (cabeçalho antes da lista) é descontada e somada de volta', () => {
    expect(anchoredScrollTop(prev, heights(150, 150, 100, 100, 100), 40 + 250, 40)).toBe(40 + 350)
  })

  it('rolagem ainda dentro do cabeçalho não ancora', () => {
    expect(anchoredScrollTop(prev, heights(300, 100, 100, 100, 100), 20, 40)).toBe(20)
  })

  it('lista que encolheu: o índice acima do novo total vai para o último item', () => {
    // topo no item 4; a lista passa a ter 2 itens ([0, 100, 200]): vale o início do último.
    expect(anchoredScrollTop(prev, buildOffsets(2, 100), 450, 0)).toBe(100)
  })

  it('lista vazia (antes ou depois) mantém a rolagem', () => {
    expect(anchoredScrollTop(prev, buildOffsets(0, 100), 250, 0)).toBe(250)
    expect(anchoredScrollTop(buildOffsets(0, 100), prev, 250, 0)).toBe(250)
  })

  it('item do topo com altura zero antes: não divide por zero', () => {
    expect(anchoredScrollTop(heights(0, 100), heights(0, 100), 10, 0)).toBe(10)
    expect(Number.isFinite(anchoredScrollTop(heights(100, 0, 100), heights(100, 50, 100), 100, 0))).toBe(true)
  })

  it('rolagem além do fim da lista antiga cai no fim do último item novo', () => {
    // total antigo 500; scrollTop 600 (espaço abaixo da lista): fração limitada a 1 no último item.
    expect(anchoredScrollTop(prev, heights(100, 100, 100, 100, 200), 600, 0)).toBe(600)
  })
})
