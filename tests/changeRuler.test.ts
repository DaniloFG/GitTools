import { describe, expect, it } from 'vitest'
import { rulerMarks, scrollTargetFor, viewportBox } from '../src/renderer/src/changeRuler'

describe('rulerMarks', () => {
  it('converte as linhas em frações da altura total', () => {
    const marks = rulerMarks([{ top: 100, height: 50, kind: 'add' }], 1000, 0)
    expect(marks).toEqual([{ top: 0.1, height: 0.05, kind: 'add' }])
  })

  it('sem conteúdo ou altura inválida não há marcas', () => {
    expect(rulerMarks([{ top: 0, height: 10, kind: 'add' }], 0, 0)).toEqual([])
    expect(rulerMarks([], 1000, 0)).toEqual([])
  })

  it('junta marcas que se sobrepõem', () => {
    const marks = rulerMarks(
      [
        { top: 0, height: 20, kind: 'add' },
        { top: 20, height: 20, kind: 'add' },
        { top: 30, height: 10, kind: 'add' },
        { top: 200, height: 10, kind: 'del' }
      ],
      1000,
      0
    )
    expect(marks).toEqual([
      { top: 0, height: 0.04, kind: 'add' },
      { top: 0.2, height: 0.01, kind: 'del' }
    ])
  })

  it('junta vizinhas de tipos diferentes como modificação, e conflito prevalece', () => {
    const mixed = rulerMarks(
      [
        { top: 0, height: 10, kind: 'add' },
        { top: 10, height: 10, kind: 'del' }
      ],
      100,
      0
    )
    expect(mixed).toEqual([{ top: 0, height: 0.2, kind: 'mod' }])

    const conflict = rulerMarks(
      [
        { top: 0, height: 10, kind: 'mod' },
        { top: 5, height: 10, kind: 'conflict' }
      ],
      100,
      0
    )
    expect(conflict).toEqual([{ top: 0, height: 0.15, kind: 'conflict' }])
  })

  it('aplica a altura mínima para linhas pequenas e não passa do fim do conteúdo', () => {
    const marks = rulerMarks([{ top: 0, height: 1, kind: 'add' }, { top: 998, height: 1, kind: 'del' }], 1000, 4)
    expect(marks[0]).toEqual({ top: 0, height: 0.004, kind: 'add' })
    expect(marks[1].top + marks[1].height).toBeCloseTo(1)
    expect(marks[1].kind).toBe('del')
  })

  it('tipo desconhecido vira modificação', () => {
    expect(rulerMarks([{ top: 0, height: 10, kind: 'estranho' }], 100, 0)).toEqual([{ top: 0, height: 0.1, kind: 'mod' }])
  })

  it('ordena as marcas pela posição, não pela ordem de entrada', () => {
    const marks = rulerMarks(
      [
        { top: 500, height: 10, kind: 'conflict' },
        { top: 10, height: 10, kind: 'add' }
      ],
      1000,
      0
    )
    expect(marks.map((m) => m.kind)).toEqual(['add', 'conflict'])
  })
})

describe('viewportBox', () => {
  it('mostra a parte visível como frações', () => {
    expect(viewportBox(250, 500, 1000)).toEqual({ top: 0.25, height: 0.5 })
  })

  it('no fim da rolagem a área termina na base', () => {
    const box = viewportBox(9999, 500, 1000)
    expect(box.top + box.height).toBeCloseTo(1)
  })

  it('sem altura de conteúdo ocupa tudo', () => {
    expect(viewportBox(0, 0, 0)).toEqual({ top: 0, height: 1 })
  })
})

describe('scrollTargetFor', () => {
  it('centraliza a posição na tela', () => {
    // Metade do conteúdo (1000px) com tela de 400px: o centro fica em 500 e o topo em 300.
    expect(scrollTargetFor(0.5, 1000, 400)).toBe(300)
  })

  it('limita entre o topo e o fim da rolagem', () => {
    expect(scrollTargetFor(0, 1000, 400)).toBe(0)
    expect(scrollTargetFor(1, 1000, 400)).toBe(600)
    expect(scrollTargetFor(0.99, 1000, 400)).toBe(600)
  })

  it('sem rolagem fica no topo', () => {
    expect(scrollTargetFor(0.5, 300, 400)).toBe(0)
  })
})
