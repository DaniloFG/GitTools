import { describe, expect, it } from 'vitest'
import { applySuggestion, suggest, type RepoContext, type Suggestion } from '../src/renderer/src/terminal/suggest'
import { GIT_COMMANDS, findCommand, pickText } from '../src/renderer/src/terminal/gitCommands'

const ctx: RepoContext = {
  branches: ['main', 'feature/x'],
  tags: ['v1.0'],
  remotes: ['origin'],
  paths: ['src/a.ts', 'README.md'],
  locale: 'en'
}

/** Sugestões para a linha com o cursor no fim. */
const at = (line: string, c: RepoContext = ctx) => suggest(line, line.length, c)
const labels = (items: Suggestion[]) => items.map((i) => i.label)

describe('catálogo', () => {
  it('cobre os subcomandos pedidos, com descrição em pt-BR e en', () => {
    for (const name of ['status', 'add', 'commit', 'checkout', 'switch', 'branch', 'merge', 'rebase', 'cherry-pick', 'stash', 'log', 'diff', 'fetch', 'pull', 'push', 'remote', 'tag', 'reset', 'restore', 'revert', 'show', 'blame', 'clean', 'config', 'reflog', 'bisect', 'worktree', 'submodule', 'gc', 'fsck', 'describe', 'shortlog', 'ls-files', 'rev-parse']) {
      const spec = findCommand(name)
      expect(spec, name).toBeDefined()
      expect(spec!.text['pt-BR'].length, name).toBeGreaterThan(10)
      expect(spec!.text.en.length, name).toBeGreaterThan(10)
      expect(spec!.syntax.startsWith('git ') || spec!.syntax.length > 0, name).toBe(true)
    }
    expect(new Set(GIT_COMMANDS.map((c) => c.name)).size).toBe(GIT_COMMANDS.length)
  })

  it('escolhe a descrição pelo idioma, com en como reserva', () => {
    const status = findCommand('status')!
    expect(pickText(status.text, 'pt-BR')).toContain('arquivos')
    expect(pickText(status.text, 'en')).toContain('changed')
    expect(pickText(status.text, 'es')).toBe(status.text.en)
  })
})

describe('sugestão de subcomandos', () => {
  it('lista tudo quando a linha está vazia, com os comandos locais', () => {
    const { items } = at('')
    expect(labels(items)).toEqual(expect.arrayContaining(['status', 'help', 'clear']))
    expect(items.find((i) => i.label === 'help')?.kind).toBe('local')
  })

  it('filtra pelo começo do que foi digitado', () => {
    const s = at('sta')
    expect(labels(s.items)).toEqual(['stash', 'status'])
    expect(s.start).toBe(0)
    expect(s.command).toBeNull()
  })

  it('funciona depois de "git" e sem diferenciar maiúsculas', () => {
    expect(labels(at('git CH').items)).toEqual(expect.arrayContaining(['checkout', 'cherry-pick']))
    expect(at('git ch').start).toBe(4)
  })

  it('sugere subcomandos do stash, do remote e do worktree (ações)', () => {
    expect(labels(at('git stash ').items)).toEqual(expect.arrayContaining(['push', 'pop', 'list']))
    expect(at('git stash ').items.every((i) => i.kind === 'op')).toBe(true)
    expect(labels(at('git remote ').items)).toEqual(expect.arrayContaining(['add', 'remove']))
  })

  it('o comando "help" sugere os nomes dos comandos', () => {
    const s = at('help st')
    expect(labels(s.items)).toEqual(['stash', 'status'])
    expect(s.start).toBe(5)
  })
})

describe('sugestão de argumentos e opções', () => {
  it('sugere branches e tags para os comandos que recebem refs', () => {
    const s = at('git checkout ')
    expect(s.command?.name).toBe('checkout')
    expect(s.items.filter((i) => i.kind === 'branch').map((i) => i.label)).toEqual(['main', 'feature/x'])
    expect(s.items.filter((i) => i.kind === 'tag').map((i) => i.label)).toEqual(['v1.0'])
    expect(labels(at('git checkout fe').items)).toEqual(['feature/x'])
  })

  it('sugere remotes primeiro e depois refs para push e fetch', () => {
    expect(labels(at('git push ').items)).toEqual(['origin'])
    expect(at('git push ').items[0].kind).toBe('remote')
    const after = at('git push origin ')
    expect(after.items.map((i) => i.kind)).toEqual(expect.arrayContaining(['branch', 'tag']))
    expect(after.items.some((i) => i.kind === 'remote')).toBe(false)
  })

  it('pula o valor de --depth ao decidir o que sugerir', () => {
    expect(labels(at('git fetch --depth 1 ').items)).toEqual(['origin'])
  })

  it('sugere caminhos alterados para add e status, e depois de "--"', () => {
    expect(labels(at('git add s').items)).toEqual(['src/a.ts'])
    expect(at('git status ').items.every((i) => i.kind === 'path')).toBe(true)
    expect(labels(at('git diff -- R').items)).toEqual(['README.md'])
  })

  it('lista as opções de um subcomando quando a palavra começa com "-"', () => {
    const s = at('git commit -')
    expect(s.command?.name).toBe('commit')
    expect(s.items.some((i) => i.kind === 'flag' && i.label === '-m, --message')).toBe(true)
    expect(s.items.find((i) => i.label === '-a, --all')?.insert).toBe('-a')
    expect(s.items.find((i) => i.label === '-a, --all')?.detail).toContain('tracked')
  })

  it('escolhe o alias que casou (ex.: --all ao digitar --a)', () => {
    const s = at('git commit --a')
    expect(s.items.find((i) => i.label === '-a, --all')?.insert).toBe('--all')
  })

  it('não sugere nada onde a palavra é o valor de uma opção', () => {
    expect(at('git commit -m ').items).toEqual([])
    expect(at('git commit -m "Corr').items).toEqual([])
    expect(at('git checkout -b ').items).toEqual([])
  })

  it('descreve a opção no idioma pedido', () => {
    const pt = suggest('git sta', 7, { ...ctx, locale: 'pt-BR' })
    expect(pt.items.find((i) => i.label === 'status')?.detail).toContain('Mostra os arquivos')
    const en = suggest('git sta', 7, ctx)
    expect(en.items.find((i) => i.label === 'status')?.detail).toContain('Shows')
  })

  it('o comando em uso é devolvido para a ajuda, mesmo sem sugestões', () => {
    expect(at('git bisect start ').command?.name).toBe('bisect')
    expect(at('git nao-existe ').command).toBeNull()
  })

  it('usa só o que está antes do cursor', () => {
    const line = 'git sta status'
    expect(labels(suggest(line, 7, ctx).items)).toEqual(['stash', 'status'])
  })
})

describe('aplicar uma sugestão', () => {
  it('troca a palavra digitada e põe um espaço depois', () => {
    const line = 'git sta'
    const s = at(line)
    const item = s.items.find((i) => i.label === 'status')!
    expect(applySuggestion(line, line.length, s, item)).toEqual({ line: 'git status ', cursor: 11 })
  })

  it('no meio de uma palavra, não deixa o resto para trás', () => {
    const line = 'git status'
    const s = suggest(line, 6, ctx) // "git st|atus"
    const item = s.items.find((i) => i.label === 'stash')!
    expect(applySuggestion(line, 6, s, item).line).toBe('git stash ')
  })

  it('acrescenta a referência escolhida ao comando', () => {
    const line = 'git checkout fe'
    const s = at(line)
    const item = s.items.find((i) => i.label === 'feature/x')!
    expect(applySuggestion(line, line.length, s, item)).toEqual({ line: 'git checkout feature/x ', cursor: 23 })
  })
})
