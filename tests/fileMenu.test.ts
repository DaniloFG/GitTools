import { describe, expect, it, vi } from 'vitest'
import { fileMenuItems } from '../src/renderer/src/fileMenu'

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
})
