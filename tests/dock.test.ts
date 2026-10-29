import { describe, expect, it } from 'vitest'
import {
  activateView,
  DOCK_VERSION,
  defaultDock,
  effectiveActive,
  findGroup,
  groupsOf,
  hideIn,
  hideView,
  inScreen,
  logicalSide,
  moveView,
  normalize,
  parseDock,
  pinnedIn,
  resizePair,
  revealIn,
  screenOf,
  SCREEN_IDS,
  SCREEN_VIEWS,
  setSizes,
  showScreen,
  shownTree,
  toggleIn,
  toggleScreenIn,
  toggleView,
  VIEW_IDS,
  zoneAt,
  type DockNode,
  type DockState,
  type ScreenId,
  type ShownNode,
  type ViewId
} from '../src/renderer/src/dock'

const viewsOf = (state: DockState) => groupsOf(state.root).flatMap((g) => g.views)
const allShown = () => true

/** Painéis à vista numa tela (com todos disponíveis), pela árvore que o Dock desenha. */
function shownIn(state: DockState, screen: ScreenId, available: (view: ViewId) => boolean = allShown): ViewId[] {
  const tree = shownTree(state, (v) => available(v) && inScreen(state, v, screen))
  const out: ViewId[] = []
  const walk = (node: ShownNode) => (node.kind === 'group' ? out.push(...node.views) : node.children.forEach((c) => walk(c.node)))
  if (tree) walk(tree)
  return out
}

describe('arranjo padrão', () => {
  it('tem cada painel exatamente uma vez', () => {
    const views = viewsOf(defaultDock())
    expect([...views].sort()).toEqual([...VIEW_IDS].sort())
  })

  it('cada painel pertence a exatamente uma tela', () => {
    const owned = Object.values(SCREEN_VIEWS).flat()
    expect([...owned].sort()).toEqual([...VIEW_IDS].sort())
    for (const screen of SCREEN_IDS) for (const view of SCREEN_VIEWS[screen]) expect(screenOf(view)).toBe(screen)
  })

  it('começa na versão atual, sem nenhum painel fixado', () => {
    expect(defaultDock()).toMatchObject({ version: DOCK_VERSION, hidden: [], pinned: {} })
  })

  it('não repete ids de grupos e divisões', () => {
    const ids: string[] = []
    const walk = (n: DockNode) => {
      ids.push(n.id)
      if (n.kind === 'split') n.children.forEach(walk)
    }
    walk(defaultDock().root)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('validação do arranjo salvo', () => {
  it('lixo ou nada volta ao padrão', () => {
    for (const bad of [undefined, null, 5, 'x', [], {}, { root: 3 }, { root: { kind: 'group', views: [] } }]) {
      expect(parseDock(bad)).toEqual(defaultDock())
    }
  })

  it('ignora painéis desconhecidos e repetidos', () => {
    const state = parseDock({ root: { kind: 'group', id: 'a', views: ['history', 'nada', 'history', 'branches'] } })
    expect(groupsOf(state.root)[0].views.filter((v) => v === 'history')).toHaveLength(1)
    expect([...viewsOf(state)].sort()).toEqual([...VIEW_IDS].sort())
  })

  it('painéis que faltam voltam para perto dos da mesma tela', () => {
    const state = parseDock({
      root: {
        kind: 'split',
        id: 's',
        dir: 'row',
        sizes: [1, 1],
        children: [
          { kind: 'group', id: 'a', views: ['branches'] },
          { kind: 'group', id: 'b', views: ['changes.unstaged'] }
        ]
      }
    })
    expect(findGroup(state, 'changes.staged')?.id).toBe('b')
    expect(findGroup(state, 'commit.diff')).toBeTruthy()
    expect([...viewsOf(state)].sort()).toEqual([...VIEW_IDS].sort())
  })

  it('um layout salvo antes do painel Editor ganha o painel junto dos outros de Arquivos', () => {
    const state = parseDock({
      root: {
        kind: 'split',
        id: 's',
        dir: 'row',
        sizes: [1, 1],
        children: [
          { kind: 'group', id: 'a', views: ['history', 'files.list'] },
          { kind: 'group', id: 'b', views: ['files.blame', 'files.diff'] }
        ]
      }
    })
    expect(findGroup(state, 'files.editor')?.id).toBe('a')
    expect(findGroup(defaultDock(), 'files.editor')?.views).toContain('files.blame')
  })

  it('corrige pesos inválidos, aba escolhida inexistente e divisões com um só filho', () => {
    const state = parseDock({
      root: {
        kind: 'split',
        id: 's',
        dir: 'row',
        sizes: [-1, 'x'],
        children: [{ kind: 'group', id: 'a', views: ['history', 'commit.diff'], active: 'branches' }]
      },
      hidden: ['gitlog', 'gitlog', 'nada']
    })
    const first = groupsOf(state.root).find((g) => g.id === 'a')!
    expect(first.active).toBeUndefined()
    expect(state.hidden).toEqual(['gitlog'])
    const split = parseDock({ root: { kind: 'split', id: 's', dir: 'row', sizes: [-1, 'x'], children: [{ kind: 'group', id: 'a', views: ['history'] }, { kind: 'group', id: 'b', views: ['branches'] }] } })
    expect(split.root.kind === 'split' && split.root.sizes).toEqual([1, 1])
  })

  it('o arranjo padrão sobrevive a salvar e ler de novo', () => {
    const d = defaultDock()
    expect(parseDock(JSON.parse(JSON.stringify(d)))).toEqual(d)
  })
})

describe('normalização', () => {
  it('une divisões do mesmo sentido, repartindo o peso', () => {
    const tree: DockNode = {
      kind: 'split',
      id: 'a',
      dir: 'row',
      sizes: [1, 2],
      children: [
        { kind: 'group', id: 'x', views: ['history'] },
        {
          kind: 'split',
          id: 'b',
          dir: 'row',
          sizes: [1, 3],
          children: [
            { kind: 'group', id: 'y', views: ['branches'] },
            { kind: 'group', id: 'z', views: ['gitlog'] }
          ]
        }
      ]
    }
    const out = normalize(tree)!
    expect(out.kind === 'split' && out.children.map((c) => c.id)).toEqual(['x', 'y', 'z'])
    expect(out.kind === 'split' && out.sizes).toEqual([1, 0.5, 1.5])
  })

  it('remove grupos vazios', () => {
    expect(normalize({ kind: 'group', id: 'a', views: [] })).toBeNull()
    const out = normalize({ kind: 'split', id: 's', dir: 'row', sizes: [1, 1], children: [{ kind: 'group', id: 'a', views: [] }, { kind: 'group', id: 'b', views: ['history'] }] })
    expect(out).toMatchObject({ kind: 'group', id: 'b' })
  })
})

describe('mover painéis', () => {
  it('qualquer painel vira aba de qualquer grupo', () => {
    const state = moveView(defaultDock(), 'commit.diff', { kind: 'tabs', group: 'g-branches' })
    expect(findGroup(state, 'commit.diff')?.id).toBe('g-branches')
    expect(findGroup(state, 'commit.diff')?.active).toBe('commit.diff')
    expect([...viewsOf(state)].sort()).toEqual([...VIEW_IDS].sort())
  })

  it('reordena abas dentro do grupo usando o índice de antes da mudança', () => {
    const base = parseDock({ root: { kind: 'group', id: 'g', views: ['history', 'branches', 'gitlog'] } })
    const g = () => groupsOf(base.root)[0].views.slice(0, 3)
    expect(g()).toEqual(['history', 'branches', 'gitlog'])
    expect(groupsOf(moveView(base, 'history', { kind: 'tabs', group: 'g', index: 3 }).root)[0].views.slice(0, 3)).toEqual(['branches', 'gitlog', 'history'])
    expect(groupsOf(moveView(base, 'gitlog', { kind: 'tabs', group: 'g', index: 0 }).root)[0].views.slice(0, 3)).toEqual(['gitlog', 'history', 'branches'])
  })

  it('divide um grupo e põe o painel no lado escolhido', () => {
    const parentOf = (root: DockNode, id: string): { parent: DockNode & { kind: 'split' }; index: number } | null => {
      if (root.kind === 'group') return null
      const index = root.children.findIndex((c) => c.kind === 'group' && c.id === id)
      if (index >= 0) return { parent: root, index }
      for (const c of root.children) {
        const found = parentOf(c, id)
        if (found) return found
      }
      return null
    }
    for (const [side, dir, before] of [['left', 'row', true], ['right', 'row', false], ['top', 'column', true], ['bottom', 'column', false]] as const) {
      const state = moveView(defaultDock(), 'gitlog', { kind: 'split', group: 'g-branches', side })
      const branches = parentOf(state.root, 'g-branches')!
      const log = parentOf(state.root, findGroup(state, 'gitlog')!.id)!
      // Os dois ficam lado a lado na mesma divisão, com o log do lado escolhido.
      expect(log.parent.id, side).toBe(branches.parent.id)
      expect(branches.parent.dir, side).toBe(dir)
      expect(log.index - branches.index, side).toBe(before ? -1 : 1)
    }
  })

  it('solta na borda da janela ocupando um quarto do espaço', () => {
    const state = moveView(defaultDock(), 'history', { kind: 'edge', side: 'bottom' })
    expect(findGroup(state, 'history')?.views).toEqual(['history'])
    const root = state.root
    expect(root.kind).toBe('split')
    if (root.kind === 'split') {
      expect(root.dir).toBe('column')
      expect(root.children.at(-1)).toMatchObject({ kind: 'group' })
      const share = root.sizes.at(-1)! / root.sizes.reduce((a, b) => a + b, 0)
      expect(share).toBeCloseTo(0.25)
    }
  })

  it('soltar na borda direita de uma janela dividida em colunas reaproveita a divisão', () => {
    const state = moveView(defaultDock(), 'gitlog', { kind: 'edge', side: 'right' })
    const root = state.root
    expect(root.kind === 'split' && root.dir).toBe('row')
    // A divisão do centro, que ficou só com a coluna de cima, passa a fazer parte da raiz.
    expect(root.kind === 'split' && root.children).toHaveLength(4)
    expect(root.kind === 'split' && root.children.at(-1)).toMatchObject({ kind: 'group', views: ['gitlog'] })
  })

  it('grupos que ficam vazios somem e o espaço volta para os vizinhos', () => {
    const before = groupsOf(defaultDock().root).length
    const state = moveView(defaultDock(), 'gitlog', { kind: 'tabs', group: 'g-main' })
    expect(groupsOf(state.root)).toHaveLength(before - 1)
    expect(groupsOf(state.root).some((g) => g.id === 'g-log')).toBe(false)
  })

  it('soltar o único painel de um grupo sobre o próprio grupo não muda nada', () => {
    const d = defaultDock()
    expect(moveView(d, 'branches', { kind: 'split', group: 'g-branches', side: 'right' })).toBe(d)
    expect(moveView(d, 'branches', { kind: 'tabs', group: 'g-branches' })).toBe(d)
  })

  it('não mexe no estado original e mostra o painel movido', () => {
    const original = hideView(defaultDock(), 'commit.diff')
    const snapshot = JSON.stringify(original)
    const moved = moveView(original, 'commit.diff', { kind: 'split', group: 'g-main', side: 'bottom' })
    expect(JSON.stringify(original)).toBe(snapshot)
    expect(moved.hidden).not.toContain('commit.diff')
  })

  it('sempre mantém cada painel exatamente uma vez, mesmo após muitos movimentos', () => {
    let state = defaultDock()
    const sides = ['left', 'right', 'top', 'bottom'] as const
    VIEW_IDS.forEach((view, i) => {
      const groups = groupsOf(state.root)
      const target = groups[(i * 7) % groups.length]
      const move = i % 3
      state = moveView(state, view, move === 0 ? { kind: 'tabs', group: target.id, index: i % 2 } : move === 1 ? { kind: 'split', group: target.id, side: sides[i % 4] } : { kind: 'edge', side: sides[(i + 1) % 4] })
      expect([...viewsOf(state)].sort(), `depois de mover ${view}`).toEqual([...VIEW_IDS].sort())
      expect(parseDock(JSON.parse(JSON.stringify(state))).root).toEqual(state.root)
    })
  })
})

describe('mostrar e esconder', () => {
  it('esconde e mostra sem tirar o painel do lugar', () => {
    const hidden = hideView(defaultDock(), 'gitlog')
    expect(hidden.hidden).toEqual(['gitlog'])
    expect(findGroup(hidden, 'gitlog')?.id).toBe('g-log')
    expect(toggleView(hidden, 'gitlog').hidden).toEqual([])
    expect(toggleView(defaultDock(), 'gitlog').hidden).toEqual(['gitlog'])
  })

  it('ativar um painel o mostra e o escolhe na aba do grupo', () => {
    const state = activateView(hideView(defaultDock(), 'changes.unstaged'), 'changes.unstaged')
    expect(state.hidden).toEqual([])
    expect(findGroup(state, 'changes.unstaged')?.active).toBe('changes.unstaged')
    const d = defaultDock()
    expect(activateView(d, 'history')).toBe(d)
    // Grupo sem aba escolhida: a primeira já está à frente.
    expect(activateView(d, 'branches')).toBe(d)
  })

  it('trazer uma tela ativa os painéis dela, só os disponíveis', () => {
    const noStaged = (v: ViewId) => v !== 'changes.staged' && v !== 'changes.conflicts' && v !== 'changes.files'
    const state = showScreen(defaultDock(), 'changes', noStaged)
    expect(findGroup(state, 'changes.unstaged')?.active).toBe('changes.unstaged')
    expect(findGroup(state, 'changes.commit')?.active).toBe('changes.commit')
    expect(findGroup(state, 'changes.diff')?.active).toBe('changes.diff')
    // Indisponível: não vira a aba escolhida (o Histórico continua à frente de Descrição).
    expect(findGroup(state, 'changes.staged')?.active).toBe('commit.message')
    expect(shownIn(state, 'changes', noStaged)).not.toContain('changes.staged')
  })

  it('trazer uma tela mostra os painéis escondidos dela', () => {
    const state = showScreen(hideView(hideView(defaultDock(), 'history'), 'commit.diff'), 'history')
    expect(state.hidden).toEqual([])
  })

  it('guarda os pesos de uma divisão válida e recusa os inválidos', () => {
    const d = defaultDock()
    const next = setSizes(d, 'd1', [1, 3])
    expect(next.root.kind === 'split' && next.root.sizes).toEqual([1, 3])
    expect(setSizes(d, 'd1', [1])).toBe(d)
    expect(setSizes(d, 'd1', [1, -2])).toBe(d)
    expect(setSizes(d, 'nao-existe', [1, 1])).toBe(d)
  })
})

describe('o que aparece na tela', () => {
  const hiddenSet = (...views: ViewId[]) => (v: ViewId) => !views.includes(v)

  it('grupos sem abas visíveis somem e a divisão com um só filho vira o próprio filho', () => {
    const tree = shownTree(defaultDock(), hiddenSet('branches', 'tags', 'stashes'))!
    // Sem a barra lateral (Branches, Tags e Stashes), a raiz passa a ser a coluna do centro.
    expect(tree.kind).toBe('split')
    if (tree.kind === 'split') expect(tree.dir).toBe('column')
  })

  it('a aba que aparece é a escolhida; se ela está escondida, a primeira visível', () => {
    const g = groupsOf(defaultDock().root).find((x) => x.id === 'g-main')!
    expect(effectiveActive(g, allShown)).toBe('history')
    expect(effectiveActive(g, hiddenSet('history'))).toBe('changes.unstaged')
    expect(effectiveActive(g, () => false)).toBeNull()
  })

  it('guarda o índice original de cada filho, para redimensionar mesmo com filhos escondidos', () => {
    const tree = shownTree(defaultDock(), hiddenSet('changes.conflicts'))!
    const find = (n: ShownNode): ShownNode | null => (n.kind === 'split' ? (n.id === 'd3' ? n : n.children.map((c) => find(c.node)).find(Boolean) ?? null) : null)
    const d3 = find(tree)
    expect(d3?.kind === 'split' && d3.children.map((c) => c.index)).toEqual([0, 1])
    // d4 só tem a lista principal visível (sem conflitos): vira o próprio grupo.
    expect(d3?.kind === 'split' && d3.children[0].node.kind).toBe('group')
  })

  it('tudo escondido não deixa nada', () => {
    expect(shownTree(defaultDock(), () => false)).toBeNull()
  })
})

describe('redimensionar e soltar', () => {
  it('divide o espaço de dois vizinhos mantendo a soma dos pesos', () => {
    const [a, b] = resizePair(1, 3, 100, 300, 100, 50, 50)
    expect(a + b).toBeCloseTo(4)
    expect(a / (a + b)).toBeCloseTo(0.5)
  })

  it('respeita os tamanhos mínimos', () => {
    const [a] = resizePair(1, 1, 200, 200, -500, 80, 80)
    expect(a / 2).toBeCloseTo(80 / 400)
    const [, b] = resizePair(1, 1, 200, 200, 500, 80, 80)
    expect(b / 2).toBeCloseTo(80 / 400)
  })

  it('zona de soltar: centro vira aba, perto das bordas divide', () => {
    const rect = { left: 0, top: 0, width: 400, height: 200 }
    expect(zoneAt(200, 100, rect)).toBe('center')
    expect(zoneAt(10, 100, rect)).toBe('left')
    expect(zoneAt(390, 100, rect)).toBe('right')
    expect(zoneAt(200, 5, rect)).toBe('top')
    expect(zoneAt(200, 195, rect)).toBe('bottom')
  })

  it('em idiomas da direita para a esquerda esquerda e direita se invertem', () => {
    expect(logicalSide('left', true)).toBe('right')
    expect(logicalSide('right', true)).toBe('left')
    expect(logicalSide('top', true)).toBe('top')
    expect(logicalSide('left', false)).toBe('left')
  })
})

describe('cada menu mostra os seus painéis', () => {
  it('no arranjo padrão, cada tela mostra exatamente os próprios painéis', () => {
    for (const screen of SCREEN_IDS) {
      expect([...shownIn(defaultDock(), screen)].sort(), screen).toEqual([...SCREEN_VIEWS[screen]].sort())
    }
  })

  it('Arquivos não mostra o diff das alterações, o commit nem a comparação', () => {
    const shown = shownIn(defaultDock(), 'files')
    expect(shown).toEqual(expect.arrayContaining(['files.list', 'files.diff', 'files.editor', 'files.blame', 'files.history']))
    for (const alien of ['changes.diff', 'changes.unstaged', 'changes.staged', 'commit.diff', 'compare.diff', 'gitlog', 'branches']) expect(shown).not.toContain(alien)
  })

  it('um painel de outra tela só aparece onde foi fixado, e o fixado persiste ao trocar de menu', () => {
    let state = revealIn(defaultDock(), 'changes.diff', 'files')
    expect(inScreen(state, 'changes.diff', 'files')).toBe(true)
    expect(inScreen(state, 'changes.diff', 'history')).toBe(false)
    expect(pinnedIn(state, 'files')).toEqual(['changes.diff'])
    state = showScreen(state, 'history')
    expect(shownIn(state, 'history')).not.toContain('changes.diff')
    state = showScreen(state, 'files')
    expect(shownIn(state, 'files')).toContain('changes.diff')
  })

  it('trazer uma tela não fixa painéis de outras telas', () => {
    const state = showScreen(defaultDock(), 'files')
    expect(state.pinned).toEqual({})
  })

  it('desfixar tira o painel só daquela tela; o próprio painel de outra tela não é afetado', () => {
    const pinned = revealIn(revealIn(defaultDock(), 'changes.diff', 'files'), 'changes.diff', 'compare')
    const out = hideIn(pinned, 'changes.diff', 'files')
    expect(pinnedIn(out, 'files')).toEqual([])
    expect(pinnedIn(out, 'compare')).toEqual(['changes.diff'])
    expect(out.pinned).not.toHaveProperty('files')
    // Desfixar algo que não estava fixado não muda nada.
    expect(hideIn(out, 'changes.diff', 'files')).toBe(out)
  })

  it('esconder o painel na própria tela não tira o fixado em outra', () => {
    const state = hideIn(revealIn(defaultDock(), 'changes.diff', 'files'), 'changes.diff', 'changes')
    expect(state.hidden).toContain('changes.diff')
    expect(inScreen(state, 'changes.diff', 'changes')).toBe(false)
    expect(inScreen(state, 'changes.diff', 'files')).toBe(true)
    // E mostrar de volta na própria tela não desfixa nada.
    expect(revealIn(state, 'changes.diff', 'changes').hidden).toEqual([])
  })

  it('esconder na própria tela vale só para ela (o painel continua mostrado em outra onde foi fixado)', () => {
    const state = hideIn(revealIn(defaultDock(), 'commit.diff', 'files'), 'commit.diff', 'history')
    expect(inScreen(state, 'commit.diff', 'history')).toBe(false)
    expect(inScreen(state, 'commit.diff', 'files')).toBe(true)
  })

  it('mostrar ou esconder um painel alterna na tela dada', () => {
    const fixed = toggleIn(defaultDock(), 'gitlog', 'history')
    expect(pinnedIn(fixed, 'history')).toEqual(['gitlog'])
    expect(inScreen(fixed, 'gitlog', 'gitlog')).toBe(true)
    expect(toggleIn(fixed, 'gitlog', 'history').pinned).toEqual({})
    const hidden = toggleIn(defaultDock(), 'gitlog', 'gitlog')
    expect(hidden.hidden).toEqual(['gitlog'])
    expect(toggleIn(hidden, 'gitlog', 'gitlog').hidden).toEqual([])
  })

  it('a barra de Branches entra e sai da tela aberta, sem mexer nas outras telas', () => {
    const inHistory = toggleScreenIn(defaultDock(), 'branches', 'history')
    expect(shownIn(inHistory, 'history')).toEqual(expect.arrayContaining(['branches', 'tags', 'stashes', 'history']))
    expect(pinnedIn(inHistory, 'history')).toEqual(['branches', 'tags', 'stashes'])
    expect(toggleScreenIn(inHistory, 'branches', 'history').pinned).toEqual({})
    // Dentro da própria tela, esconder é esconder o menu inteiro; mostrar de novo traz tudo.
    const hiddenInOwn = toggleScreenIn(defaultDock(), 'branches', 'branches')
    expect(hiddenInOwn.hidden.sort()).toEqual(['branches', 'stashes', 'tags'])
    expect(toggleScreenIn(hiddenInOwn, 'branches', 'branches').hidden).toEqual([])
  })

  it('a barra de Branches ignora painéis indisponíveis', () => {
    const noTags = (v: ViewId) => v !== 'tags'
    const state = toggleScreenIn(defaultDock(), 'branches', 'history', noTags)
    expect(pinnedIn(state, 'history')).toEqual(['branches', 'stashes'])
  })

  it('mover um painel fixado não o desfixa', () => {
    const state = moveView(revealIn(defaultDock(), 'changes.diff', 'files'), 'changes.diff', { kind: 'tabs', group: 'g-branches' })
    expect(pinnedIn(state, 'files')).toEqual(['changes.diff'])
    expect(inScreen(state, 'changes.diff', 'files')).toBe(true)
  })
})

describe('versão do arranjo guardado', () => {
  it('layout da versão 1 (sem versão nem fixados) é lido sem perder árvore nem escondidos', () => {
    const d = hideView(defaultDock(), 'gitlog')
    const { version: _version, pinned: _pinned, ...legacy } = JSON.parse(JSON.stringify(d)) as DockState
    const state = parseDock({ ...legacy, hidden: ['gitlog'] })
    expect(state.version).toBe(DOCK_VERSION)
    expect(state.pinned).toEqual({})
    expect(state.root).toEqual(d.root)
    expect(state.hidden).toEqual(['gitlog'])
    // Nenhuma tela ganha painéis de outra só por causa da migração.
    expect(shownIn(state, 'history')).not.toContain('changes.diff')
  })

  it('um arranjo sem versão e sem fixados é o mesmo arranjo padrão', () => {
    const d = defaultDock()
    const { version: _version, pinned: _pinned, ...legacy } = JSON.parse(JSON.stringify(d)) as DockState
    expect(parseDock(legacy)).toEqual(d)
  })

  it('fixados inválidos são descartados: painel da própria tela, nomes desconhecidos, repetidos e tela inexistente', () => {
    const state = parseDock({
      ...JSON.parse(JSON.stringify(defaultDock())),
      pinned: { files: ['files.list', 'changes.diff', 'changes.diff', 'nada'], nope: ['tags'], history: 'x', compare: ['changes.diff'] }
    })
    expect(state.pinned).toEqual({ files: ['changes.diff'], compare: ['changes.diff'] })
  })

  it('o arranjo com fixados sobrevive a salvar e ler de novo', () => {
    const state = toggleScreenIn(revealIn(defaultDock(), 'changes.diff', 'files'), 'branches', 'history')
    expect(parseDock(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })
})
