// Itens do menu de contexto de um arquivo nas telas Files e Compare. Lógica pura, sem React, para ser testada;
// quem monta o menu (components/FilesView.tsx e CompareView.tsx) passa os textos já traduzidos.
import { changeKeys } from '../../shared/diffKeys'
import type { FileDiff, LineKey } from '../../shared/types'

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
  /**
   * Ação extra do arquivo (ex.: "Aplicar arquivo inteiro em …" na Compare). Quem monta o menu decide quando ela
   * existe; aqui só entra na ordem, entre abrir no editor e copiar o caminho.
   */
  apply?: { label: string; onClick(): void }
}

/** Abrir no editor (quando há arquivo), a ação extra (quando vier) e copiar o caminho, nesta ordem. */
export function fileMenuItems({ path, canOpen, openInEditor, copy, labels, apply }: FileMenuOptions): FileMenuItem[] {
  const items: FileMenuItem[] = []
  if (canOpen) items.push({ label: labels.openInEditor, onClick: () => openInEditor(path) })
  if (apply) items.push(apply)
  items.push({ label: labels.copyPath, onClick: () => copy(path) })
  return items
}

/**
 * Quando "Aplicar arquivo inteiro" (#59) é oferecido. Sem branch atual não há onde aplicar; arquivo apagado (D) não
 * tem o que trazer; e aplicar a branch nela mesma não faz sentido: `to` igual à branch atual, ou `HEAD` (que é a
 * própria branch atual quando ela está checada out) é auto-aplicação. Sem comparação (`to` ausente), não há arquivo.
 */
export function canApplyFile({ head, to, status }: { head: string | null | undefined; to: string | null | undefined; status: string }): boolean {
  if (!head || !to || status === 'D') return false
  return to !== head && to !== 'HEAD'
}

/**
 * Chaves de todas as linhas alteradas do arquivo `path` no diff, para `applyLines`. Só a correspondência exata do
 * caminho conta: se o diff não trouxer o arquivo, não se aplica o primeiro arquivo que veio no lugar dele. Binário
 * não tem linha, e um arquivo sem linha +/- (só troca de modo, por exemplo) não tem o que aplicar.
 */
export function wholeFileKeys(files: FileDiff[], path: string): { keys: LineKey[] } | { error: 'noChanges' | 'binary' } {
  const file = files.find((f) => f.path === path)
  if (!file) return { error: 'noChanges' }
  if (file.binary) return { error: 'binary' }
  const keys = changeKeys(file)
  return keys.length === 0 ? { error: 'noChanges' } : { keys }
}
