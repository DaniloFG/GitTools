// Qual editor os itens "abrir no editor" dos menus de arquivo representam. Lógica pura, sem React: quem monta o menu
// (CommitList, CommitDetails, ChangesView, FilesView, CompareView) lê `settings.editor` e `insideVsCode()` e passa aqui.
import type { MessageKey } from '../../shared/i18n'

export type EditorKind = 'vscode' | 'gittools' | 'other'

/**
 * Dentro do VS Code os arquivos abrem no editor dele (não há o que escolher); fora, `''` é "nenhum editor externo",
 * ou seja, o editor embutido do GitTools; `vscode` e `vscode-insiders` são os ids detectados; o resto é outro
 * editor (id detectado ou caminho do executável).
 */
export function editorKind(editor: string, inVsCode: boolean): EditorKind {
  if (inVsCode || editor === 'vscode' || editor === 'vscode-insiders') return 'vscode'
  return editor === '' ? 'gittools' : 'other'
}

export function editorLabelKey(kind: EditorKind): MessageKey {
  if (kind === 'vscode') return 'common.openInVscode'
  return kind === 'gittools' ? 'common.openInGitToolsEditor' : 'common.openInEditor'
}

/**
 * Ação do clique. No editor do GitTools o arquivo abre na tela Files (FileEditor embutido), em vez do aviso
 * "escolha um editor" que `openInEditor` mostra quando não há editor configurado.
 */
export function openEditorItem(
  kind: EditorKind,
  path: string,
  actions: { openFileView(path: string): void; openInEditor(path: string): void }
): () => void {
  return kind === 'gittools' ? () => actions.openFileView(path) : () => actions.openInEditor(path)
}
