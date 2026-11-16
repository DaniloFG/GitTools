import { describe, expect, it } from 'vitest'
import { GRAPH_MAX_WIDTH, GRAPH_MIN_WIDTH, clampGraphWidth, parseGraphWidth, resolveGraphWidth } from '../src/renderer/src/graphWidth'

describe('limites da largura do Graph', () => {
  it('mínimo 52 (uma trilha e o ponto) e máximo 1200', () => {
    expect(GRAPH_MIN_WIDTH).toBe(52)
    expect(GRAPH_MAX_WIDTH).toBe(1200)
  })
})

describe('parseGraphWidth', () => {
  it('o que não é número finito vira automática (null)', () => {
    for (const v of [null, undefined, '', '120', 'abc', NaN, Infinity, -Infinity, {}, [], true]) {
      expect(parseGraphWidth(v)).toBeNull()
    }
  })

  it('número finito vira largura inteira, levada para dentro do intervalo', () => {
    expect(parseGraphWidth(120)).toBe(120)
    expect(parseGraphWidth(120.4)).toBe(120)
    expect(parseGraphWidth(120.6)).toBe(121)
    expect(parseGraphWidth(-5)).toBe(GRAPH_MIN_WIDTH)
    expect(parseGraphWidth(0)).toBe(GRAPH_MIN_WIDTH)
    expect(parseGraphWidth(5000)).toBe(GRAPH_MAX_WIDTH)
  })
})

describe('clampGraphWidth', () => {
  it('nos limites devolve os próprios limites', () => {
    expect(clampGraphWidth(GRAPH_MIN_WIDTH)).toBe(GRAPH_MIN_WIDTH)
    expect(clampGraphWidth(GRAPH_MAX_WIDTH)).toBe(GRAPH_MAX_WIDTH)
  })

  it('abaixo do mínimo e acima do máximo são cortados', () => {
    expect(clampGraphWidth(51)).toBe(GRAPH_MIN_WIDTH)
    expect(clampGraphWidth(-Infinity)).toBe(GRAPH_MIN_WIDTH)
    expect(clampGraphWidth(1201)).toBe(GRAPH_MAX_WIDTH)
    expect(clampGraphWidth(Infinity)).toBe(GRAPH_MAX_WIDTH)
  })

  it('o resultado é sempre inteiro', () => {
    expect(clampGraphWidth(53.4)).toBe(53)
    expect(clampGraphWidth(53.5)).toBe(54)
  })
})

describe('resolveGraphWidth', () => {
  it('sem preferência (null) devolve a automática exatamente como ela veio', () => {
    for (const auto of [GRAPH_MIN_WIDTH, 60, 92, 134, 176]) {
      expect(resolveGraphWidth(auto, null)).toBe(auto)
    }
  })

  it('com preferência usa o valor levado para o intervalo, não a automática', () => {
    expect(resolveGraphWidth(176, 300)).toBe(300)
    expect(resolveGraphWidth(176, 52)).toBe(52)
    expect(resolveGraphWidth(176, parseGraphWidth(300.5))).toBe(301)
  })

  it('preferência fora do intervalo chega cortada, porque é lida com parseGraphWidth', () => {
    expect(resolveGraphWidth(176, parseGraphWidth(10))).toBe(GRAPH_MIN_WIDTH)
    expect(resolveGraphWidth(176, parseGraphWidth(9999))).toBe(GRAPH_MAX_WIDTH)
    expect(resolveGraphWidth(176, parseGraphWidth(-Infinity))).toBe(176)
  })
})
