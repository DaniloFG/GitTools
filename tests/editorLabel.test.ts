import { describe, expect, it, vi } from 'vitest'
import { editorKind, editorLabelKey, openEditorItem } from '../src/renderer/src/editorLabel'
import { LOCALE_IDS } from '../src/shared/i18n'
import { CATALOGS } from '../src/shared/i18n/messages'

describe('editorKind', () => {
  it('sem editor configurado, o editor é o do próprio GitTools', () => {
    expect(editorKind('', false)).toBe('gittools')
  })

  it('os ids do VS Code (estável e Insiders) são "vscode"', () => {
    expect(editorKind('vscode', false)).toBe('vscode')
    expect(editorKind('vscode-insiders', false)).toBe('vscode')
  })

  it('outro id ou um caminho de executável é "other"', () => {
    expect(editorKind('sublime', false)).toBe('other')
    expect(editorKind('/usr/bin/subl', false)).toBe('other')
    expect(editorKind('C:\\Program Files\\Notepad++\\notepad++.exe', false)).toBe('other')
  })

  it('dentro do VS Code ele vence qualquer valor configurado, inclusive vazio', () => {
    for (const editor of ['', 'vscode', 'vscode-insiders', '/usr/bin/subl', 'sublime']) expect(editorKind(editor, true)).toBe('vscode')
  })
})

describe('editorLabelKey', () => {
  it('cada tipo tem o seu rótulo', () => {
    expect(editorLabelKey('vscode')).toBe('common.openInVscode')
    expect(editorLabelKey('gittools')).toBe('common.openInGitToolsEditor')
    expect(editorLabelKey('other')).toBe('common.openInEditor')
  })
})

describe('openEditorItem', () => {
  const fixture = () => ({ openFileView: vi.fn<(path: string) => void>(), openInEditor: vi.fn<(path: string) => void>() })

  it('"gittools" abre a tela Files e não chama o editor externo', () => {
    const actions = fixture()
    openEditorItem('gittools', 'src/a b.ts', actions)()
    expect(actions.openFileView).toHaveBeenCalledExactlyOnceWith('src/a b.ts')
    expect(actions.openInEditor).not.toHaveBeenCalled()
  })

  it.each(['vscode', 'other'] as const)('"%s" abre no editor externo e não muda de tela', (kind) => {
    const actions = fixture()
    openEditorItem(kind, 'src/a.ts', actions)()
    expect(actions.openInEditor).toHaveBeenCalledExactlyOnceWith('src/a.ts')
    expect(actions.openFileView).not.toHaveBeenCalled()
  })

  it('nada é chamado antes do clique', () => {
    const actions = fixture()
    openEditorItem('gittools', 'a.ts', actions)
    expect(actions.openFileView).not.toHaveBeenCalled()
    expect(actions.openInEditor).not.toHaveBeenCalled()
  })
})

describe('catálogos', () => {
  it('common.openInGitToolsEditor existe e não é vazia nos seis idiomas', () => {
    for (const id of LOCALE_IDS) {
      const value = (CATALOGS[id] as { common: Record<string, unknown> }).common.openInGitToolsEditor
      expect(typeof value, id).toBe('string')
      expect((value as string).trim(), id).not.toBe('')
    }
  })
})
