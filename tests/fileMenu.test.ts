import { describe, expect, it, vi } from 'vitest'
import { canApplyFile, fileMenuItems, wholeFileKeys } from '../src/renderer/src/fileMenu'
import type { FileDiff } from '../src/shared/types'

const labels = { openInEditor: 'Abrir no editor VSCode', copyPath: 'Copiar caminho' }
const path = 'docs/ação "x" - y.md'

describe('menu de contexto de arquivo', () => {
  it('sem editor (arquivo que não existe na árvore), só copiar o caminho', () => {
    const items = fileMenuItems({ path, canOpen: false, openInEditor: vi.fn(), copy: vi.fn(), labels })
    expect(items.map((i) => i.label)).toEqual(['Copiar caminho'])
  })

  it('com editor, abrir no VSCode vem antes de copiar o caminho', () => {
    const items = fileMenuItems({ path, canOpen: true, openInEditor: vi.fn(), copy: vi.fn(), labels })
    expect(items.map((i) => i.label)).toEqual(['Abrir no editor VSCode', 'Copiar caminho'])
  })

  it('cada item chama o callback com o caminho do arquivo', () => {
    const openInEditor = vi.fn()
    const copy = vi.fn()
    const [open, copyItem] = fileMenuItems({ path, canOpen: true, openInEditor, copy, labels })
    open.onClick()
    copyItem.onClick()
    expect(openInEditor).toHaveBeenCalledExactlyOnceWith(path)
    expect(copy).toHaveBeenCalledExactlyOnceWith(path)
  })

  it('sem editor, o único item não abre nada', () => {
    const openInEditor = vi.fn()
    const copy = vi.fn()
    const [copyItem] = fileMenuItems({ path, canOpen: false, openInEditor, copy, labels })
    copyItem.onClick()
    expect(openInEditor).not.toHaveBeenCalled()
    expect(copy).toHaveBeenCalledExactlyOnceWith(path)
  })

  it('sem apply, o menu é o de sempre (abrir e copiar)', () => {
    const items = fileMenuItems({ path, canOpen: true, openInEditor: vi.fn(), copy: vi.fn(), labels, apply: undefined })
    expect(items.map((i) => i.label)).toEqual(['Abrir no editor VSCode', 'Copiar caminho'])
  })

  it('com apply, a ordem é abrir no editor, aplicar e copiar o caminho', () => {
    const apply = { label: 'Aplicar arquivo inteiro em main', onClick: vi.fn() }
    const items = fileMenuItems({ path, canOpen: true, openInEditor: vi.fn(), copy: vi.fn(), labels, apply })
    expect(items.map((i) => i.label)).toEqual(['Abrir no editor VSCode', 'Aplicar arquivo inteiro em main', 'Copiar caminho'])
  })

  it('com canOpen=false e apply, aplicar vem antes de copiar o caminho e não há abrir no editor', () => {
    const apply = { label: 'Aplicar arquivo inteiro em main', onClick: vi.fn() }
    const items = fileMenuItems({ path, canOpen: false, openInEditor: vi.fn(), copy: vi.fn(), labels, apply })
    expect(items.map((i) => i.label)).toEqual(['Aplicar arquivo inteiro em main', 'Copiar caminho'])
  })

  it('o item de aplicar chama o próprio callback, não abre nem copia', () => {
    const openInEditor = vi.fn()
    const copy = vi.fn()
    const onApply = vi.fn()
    const apply = { label: 'Aplicar arquivo inteiro em main', onClick: onApply }
    const [, applyItem] = fileMenuItems({ path, canOpen: true, openInEditor, copy, labels, apply })
    applyItem.onClick()
    expect(onApply).toHaveBeenCalledOnce()
    expect(openInEditor).not.toHaveBeenCalled()
    expect(copy).not.toHaveBeenCalled()
  })
})

/** Diff de um arquivo com um hunk: uma remoção (0:0), uma adição (0:1) e uma linha de contexto (0:2). */
function fileDiff(p: string, over: Partial<FileDiff> = {}): FileDiff {
  return {
    oldPath: p,
    newPath: p,
    path: p,
    changeType: 'modified',
    binary: false,
    headerLines: [],
    hunks: [
      {
        oldStart: 1,
        oldCount: 2,
        newStart: 1,
        newCount: 2,
        section: '',
        lines: [
          { kind: 'del', content: 'antes', oldLine: 1, newLine: null },
          { kind: 'add', content: 'depois', oldLine: null, newLine: 1 },
          { kind: 'context', content: 'igual', oldLine: 2, newLine: 2 }
        ]
      }
    ],
    additions: 1,
    deletions: 1,
    ...over
  }
}

/** Diff só de contexto: o arquivo mudou, mas não há linha +/- (ex.: troca de modo ou hunk vazio). */
function contextOnly(p: string): FileDiff {
  return fileDiff(p, {
    hunks: [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, section: '', lines: [{ kind: 'context', content: 'igual', oldLine: 1, newLine: 1 }] }],
    additions: 0,
    deletions: 0
  })
}

describe('aplicar arquivo inteiro', () => {
  it('chaves: todas as linhas +/- do arquivo, sem as de contexto', () => {
    expect(wholeFileKeys([fileDiff('a.md')], 'a.md')).toEqual({ keys: ['0:0', '0:1'] })
  })

  it('escolhe pelo caminho exato entre vários arquivos', () => {
    expect(wholeFileKeys([contextOnly('b.md'), fileDiff('a.md')], 'a.md')).toEqual({ keys: ['0:0', '0:1'] })
  })

  it('caminho sem correspondência não pega o primeiro arquivo do diff', () => {
    expect(wholeFileKeys([fileDiff('outro.md')], 'a.md')).toEqual({ error: 'noChanges' })
  })

  it('lista de diff vazia é sem alterações', () => {
    expect(wholeFileKeys([], 'a.md')).toEqual({ error: 'noChanges' })
  })

  it('arquivo binário não tem linhas para aplicar', () => {
    expect(wholeFileKeys([fileDiff('img.png', { binary: true, hunks: [], additions: 0, deletions: 0 })], 'img.png')).toEqual({ error: 'binary' })
  })

  it('sem linha alterada (só contexto) é sem alterações', () => {
    expect(wholeFileKeys([contextOnly('a.md')], 'a.md')).toEqual({ error: 'noChanges' })
  })

  it('pode aplicar quando há arquivo, branch atual diferente da comparada e status que não é D', () => {
    expect(canApplyFile({ head: 'main', to: 'feature', status: 'M' })).toBe(true)
    expect(canApplyFile({ head: 'main', to: 'feature', status: 'A' })).toBe(true)
  })

  it('arquivo apagado (D) não pode ser aplicado', () => {
    expect(canApplyFile({ head: 'main', to: 'feature', status: 'D' })).toBe(false)
  })

  it('branch atual igual à comparada (to) não pode: seria aplicar em si mesma', () => {
    expect(canApplyFile({ head: 'main', to: 'main', status: 'M' })).toBe(false)
  })

  it('to igual a HEAD não pode quando a branch atual é a própria HEAD: é auto-aplicação', () => {
    expect(canApplyFile({ head: 'main', to: 'HEAD', status: 'M' })).toBe(false)
  })

  it('sem branch atual (HEAD destacado ou sem repositório) não pode', () => {
    expect(canApplyFile({ head: null, to: 'feature', status: 'M' })).toBe(false)
    expect(canApplyFile({ head: undefined, to: 'feature', status: 'M' })).toBe(false)
  })

  it('sem comparação (to ausente) não pode', () => {
    expect(canApplyFile({ head: 'main', to: undefined, status: 'M' })).toBe(false)
  })
})
