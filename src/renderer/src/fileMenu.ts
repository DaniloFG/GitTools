// Itens do menu de contexto de um arquivo nas telas Files e Compare. Lógica pura, sem React, para ser testada;
// quem monta o menu (components/FilesView.tsx e CompareView.tsx) passa os textos já traduzidos.

/** Item do menu de contexto. Tem a mesma forma de `MenuItem` (components/ContextMenu.tsx), sem importá-lo: o teste roda sem React. */
export interface FileMenuItem {
  label: string
  onClick(): void
}

export interface FileMenuOptions {
  path: string
  /**
   * Quando o arquivo existe na árvore de trabalho. Arquivo apagado numa comparação (status D) não tem o que abrir
   * no editor, então o item some e fica só copiar o caminho.
   */
  canOpen: boolean
  openInEditor(path: string): void
  copy(text: string): void
  labels: { openInEditor: string; copyPath: string }
}

/** Abrir no editor (quando há arquivo) e copiar o caminho, nesta ordem. */
export function fileMenuItems({ path, canOpen, openInEditor, copy, labels }: FileMenuOptions): FileMenuItem[] {
  const copyItem: FileMenuItem = { label: labels.copyPath, onClick: () => copy(path) }
  if (!canOpen) return [copyItem]
  return [{ label: labels.openInEditor, onClick: () => openInEditor(path) }, copyItem]
}
