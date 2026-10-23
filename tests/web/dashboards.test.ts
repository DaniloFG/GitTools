import { describe, expect, it } from 'vitest'
import { CATALOGS } from '../../src/shared/i18n/messages'
import { LOCALE_IDS } from '../../src/shared/i18n'
import {
  DASHBOARDS,
  WIDGETS,
  WIDGET_BY_ID,
  addCustom,
  addWidget,
  instance,
  moveBefore,
  moveWidget,
  parsePrefs,
  presetWidgets,
  removeCustom,
  removeWidget,
  renameCustom,
  resetDashboard,
  resizeCols,
  updateWidget,
  widgetsFor,
  withWidgets
} from '../../src/renderer/src/analytics/widgets'

type Tree = { [key: string]: string | Tree }
const lookup = (tree: Tree, path: string): unknown => path.split('.').reduce<unknown>((node, key) => (node as Tree | undefined)?.[key], tree)

describe('catálogo de widgets', () => {
  it('todo widget tem título e descrição em todos os idiomas, e formas de ver válidas', () => {
    expect(new Set(WIDGETS.map((w) => w.id)).size).toBe(WIDGETS.length)
    for (const id of LOCALE_IDS) {
      for (const w of WIDGETS) {
        expect(typeof lookup(CATALOGS[id] as unknown as Tree, `dash.w.${w.id}`), `${id} dash.w.${w.id}`).toBe('string')
        expect(typeof lookup(CATALOGS[id] as unknown as Tree, `dash.wd.${w.id}`), `${id} dash.wd.${w.id}`).toBe('string')
        for (const v of w.views) expect(typeof lookup(CATALOGS[id] as unknown as Tree, `dash.views.${v}`), `${id} dash.views.${v}`).toBe('string')
      }
    }
    for (const w of WIDGETS) expect(w.views.length).toBeGreaterThan(0)
  })

  it('cada dashboard pronto abre com pelo menos 4 tipos de gráfico diferentes e sem repetir identificadores', () => {
    for (const id of DASHBOARDS) {
      const list = presetWidgets(id)
      expect(list.length, id).toBeGreaterThanOrEqual(4)
      expect(new Set(list.map((w) => w.uid)).size).toBe(list.length)
      expect(new Set(list.map((w) => w.view)).size, id).toBeGreaterThanOrEqual(4)
      for (const w of list) expect(WIDGET_BY_ID.get(w.widget)!.views).toContain(w.view)
    }
  })

  it('a visão geral oferece ao menos 6 formas diferentes logo na primeira tela', () => {
    expect(new Set(presetWidgets('overview').map((w) => w.view)).size).toBeGreaterThanOrEqual(6)
  })
})

describe('preferências dos dashboards', () => {
  it('valida o que foi lido e descarta o que não existe mais', () => {
    expect(parsePrefs(undefined)).toMatchObject({ active: 'overview', period: '12m', scope: 'all', includeMerges: true, excludeBots: false, custom: [] })
    const p = parsePrefs({
      active: 'inexistente',
      period: '90d',
      scope: 'head',
      includeMerges: false,
      excludeBots: true,
      overrides: { people: [{ uid: 'a', widget: 'top-people', view: 'donut', cols: 6, rows: 3, options: { metric: 'lines', lixo: 'x' } }, { uid: 'b', widget: 'nao-existe', view: 'area' }, { uid: 'a', widget: 'kpis', view: 'tiles' }] },
      custom: [{ id: 'c1', name: '  Meu  ', widgets: [{ uid: 'x', widget: 'kpis', view: 'gauge' }] }, { id: 'c1', name: 'duplicado', widgets: [] }, { id: 'c2', name: '', widgets: [] }]
    })
    expect(p).toMatchObject({ active: 'overview', period: '90d', scope: 'head', includeMerges: false, excludeBots: true })
    expect(p.overrides.people).toEqual([{ uid: 'a', widget: 'top-people', view: 'donut', cols: 6, rows: 3, options: { metric: 'lines' } }])
    // Forma de ver inválida volta à primeira do widget.
    expect(p.custom).toEqual([{ id: 'c1', name: 'Meu', widgets: [{ uid: 'x', widget: 'kpis', view: 'tiles' }] }])
    expect(parsePrefs({ active: 'c1', custom: [{ id: 'c1', name: 'A', widgets: [] }] }).active).toBe('c1')
    expect(parsePrefs({ period: 'ontem' }).period).toBe('12m')
  })

  it('personaliza dashboards prontos sem mexer nos outros, e restaura', () => {
    let prefs = parsePrefs({})
    expect(widgetsFor(prefs, 'people')).toEqual(presetWidgets('people'))
    prefs = withWidgets(prefs, 'people', removeWidget(widgetsFor(prefs, 'people'), 'top-people-1'))
    expect(widgetsFor(prefs, 'people').some((w) => w.uid === 'top-people-1')).toBe(false)
    expect(widgetsFor(prefs, 'code')).toEqual(presetWidgets('code'))
    prefs = resetDashboard(prefs, 'people')
    expect(widgetsFor(prefs, 'people')).toEqual(presetWidgets('people'))
  })

  it('cria, renomeia e exclui dashboards personalizados', () => {
    const created = addCustom(parsePrefs({}), '  Revisão semanal ')
    expect(created.id).toBe('custom-1')
    let prefs = created.prefs
    expect(prefs.active).toBe('custom-1')
    expect(widgetsFor(prefs, 'custom-1')).toEqual([])
    prefs = withWidgets(prefs, 'custom-1', addWidget(addWidget([], 'kpis'), 'kpis'))
    expect(widgetsFor(prefs, 'custom-1').map((w) => w.uid)).toEqual(['kpis-1', 'kpis-2'])
    prefs = renameCustom(prefs, 'custom-1', 'Outro nome')
    expect(prefs.custom[0].name).toBe('Outro nome')
    expect(renameCustom(prefs, 'custom-1', '   ')).toBe(prefs)
    prefs = resetDashboard(prefs, 'custom-1')
    expect(widgetsFor(prefs, 'custom-1')).toEqual([])
    expect(addCustom(prefs, 'x').id).toBe('custom-2')
    expect(removeCustom(prefs, 'custom-1')).toMatchObject({ active: 'overview', custom: [] })
  })

  it('reordena, redimensiona e troca a forma de ver', () => {
    const list = [instance('kpis', 'a'), instance('top-people', 'b'), instance('calendar', 'c')]
    expect(moveWidget(list, 'b', -1).map((w) => w.uid)).toEqual(['b', 'a', 'c'])
    expect(moveWidget(list, 'a', -1)).toBe(list)
    expect(moveWidget(list, 'c', 1)).toBe(list)
    expect(moveBefore(list, 'c', 'a').map((w) => w.uid)).toEqual(['c', 'a', 'b'])
    expect(moveBefore(list, 'a', 'a')).toBe(list)
    expect(updateWidget(list, 'b', { view: 'donut' })[1]).toMatchObject({ view: 'donut' })
    expect(resizeCols(6, 1)).toBe(8)
    expect(resizeCols(6, -1)).toBe(4)
    expect(resizeCols(12, 1)).toBe(12)
    expect(resizeCols(3, -1)).toBe(3)
    expect(instance('top-people', 'z', 'treemap').view).toBe('treemap')
    expect(instance('top-people', 'z', 'funnel').view).toBe('list')
  })
})
