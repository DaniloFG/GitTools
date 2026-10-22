import { describe, expect, it } from 'vitest'
import {
  defaultLayout,
  moveByStep,
  moveSection,
  parseChangesLayout,
  resizePair,
  visibleColumns,
  type ChangesLayout
} from '../src/renderer/src/changesLayout'

const base = (): ChangesLayout => defaultLayout('stage')

describe('disposição da aba Alterações', () => {
  it('padrão: listas e commit numa coluna, diff ao lado', () => {
    expect(base().columns).toEqual([['conflicts', 'unstaged', 'staged', 'commit'], ['diff']])
    expect(defaultLayout('check').columns).toEqual([['conflicts', 'files', 'commit'], ['diff']])
  })

  it('valida o que foi guardado: ignora ids de outra visão e repetidos, e recoloca os que faltam', () => {
    const parsed = parseChangesLayout({ columns: [['staged', 'files', 'staged', 'x'], ['unstaged']], weights: { staged: 2, unstaged: -1 }, widths: [1, 2] }, 'stage')
    expect(parsed.columns).toEqual([['staged', 'conflicts', 'commit'], ['unstaged'], ['diff']])
    expect(parsed.weights).toEqual({ staged: 2 })
    // Número de colunas mudou: as larguras guardadas não valem mais.
    expect(parsed.widths).toEqual([])
    expect(parseChangesLayout(null, 'check')).toEqual(defaultLayout('check'))
    expect(parseChangesLayout({ columns: 'x' }, 'stage')).toEqual(base())
  })

  it('cada visão tem a sua disposição (o painel "files" não existe em duas listas)', () => {
    const stage = parseChangesLayout({ columns: [['files', 'unstaged', 'staged', 'commit', 'diff']] }, 'stage')
    expect(stage.columns.flat().sort()).toEqual(['commit', 'conflicts', 'diff', 'staged', 'unstaged'])
  })

  it('move antes ou depois de outro painel, na mesma coluna ou em outra', () => {
    const l = base()
    expect(moveSection(l, 'commit', { kind: 'section', id: 'unstaged', where: 'before' }).columns[0]).toEqual(['conflicts', 'commit', 'unstaged', 'staged'])
    expect(moveSection(l, 'staged', { kind: 'section', id: 'diff', where: 'after' }).columns).toEqual([['conflicts', 'unstaged', 'commit'], ['diff', 'staged']])
    expect(moveSection(l, 'staged', { kind: 'section', id: 'staged', where: 'after' })).toBe(l)
  })

  it('soltar na borda cria uma coluna; colunas vazias somem e as larguras voltam ao padrão', () => {
    const l = { ...base(), widths: [1, 3] }
    const edge = moveSection(l, 'commit', { kind: 'edge', side: 'end' })
    expect(edge.columns).toEqual([['conflicts', 'unstaged', 'staged'], ['diff'], ['commit']])
    expect(edge.widths).toEqual([])
    const empty = moveSection(l, 'diff', { kind: 'section', id: 'commit', where: 'after' })
    expect(empty.columns).toEqual([['conflicts', 'unstaged', 'staged', 'commit', 'diff']])
    expect(empty.widths).toEqual([])
    // Só reordenar não mexe nas larguras.
    expect(moveSection(l, 'staged', { kind: 'section', id: 'unstaged', where: 'before' }).widths).toEqual([1, 3])
  })

  it('passos do menu: subir, descer e trocar de coluna', () => {
    const l = base()
    expect(moveByStep(l, 'conflicts', 'up')).toBe(l)
    expect(moveByStep(l, 'staged', 'up').columns[0]).toEqual(['conflicts', 'staged', 'unstaged', 'commit'])
    expect(moveByStep(l, 'staged', 'down').columns[0]).toEqual(['conflicts', 'unstaged', 'commit', 'staged'])
    expect(moveByStep(l, 'staged', 'right').columns).toEqual([['conflicts', 'unstaged', 'commit'], ['staged', 'diff']])
    // Na última coluna, "para a direita" cria uma nova se o painel não estiver sozinho.
    const right = moveByStep(l, 'staged', 'right')
    expect(moveByStep(right, 'staged', 'right').columns).toEqual([['conflicts', 'unstaged', 'commit'], ['diff'], ['staged']])
    // Sozinho na única coluna da ponta: nada a fazer.
    expect(moveByStep(l, 'diff', 'right')).toBe(l)
  })

  it('divisória entre dois painéis: respeita os mínimos e mantém a soma dos pesos', () => {
    const [a, b] = resizePair(1, 1, 200, 200, 50, 80, 80)
    expect(a / b).toBeCloseTo(250 / 150)
    expect(a + b).toBeCloseTo(2)
    const [c, d] = resizePair(1, 1, 200, 200, 1000, 80, 80)
    expect(d / (c + d)).toBeCloseTo(80 / 400)
    const [e, f] = resizePair(1, 3, 100, 100, -1000, 60, 60)
    expect(e / (e + f)).toBeCloseTo(60 / 200)
    expect(e + f).toBeCloseTo(4)
    expect(resizePair(1, 2, 0, 0, 10, 10, 10)).toEqual([1, 2])
  })

  it('só mostra os painéis que existem agora', () => {
    const present = new Set(['unstaged', 'commit', 'diff'] as const)
    expect(visibleColumns(base(), present)).toEqual([['unstaged', 'commit'], ['diff']])
    expect(visibleColumns(base(), new Set(['diff'] as const))).toEqual([['diff']])
  })
})
