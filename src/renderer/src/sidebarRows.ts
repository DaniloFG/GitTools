// Linhas da barra lateral (branches e tags) achatadas na ordem da tela. Sem React: a tela só desenha.
// O recuo é o mesmo da lista de arquivos (TREE_INDENT), para as duas árvores ficarem iguais.

import { buildTree, flattenTree, type TreeNode } from './fileTree'

/** Recuo (em px) de cada nível da árvore; o mesmo da lista de arquivos. */
export const TREE_INDENT = 14
/** Margem à esquerda de toda linha da árvore. */
const BASE_INDENT = 6
/** Os itens ficam 16 px à direita da pasta do mesmo nível, para o ícone da branch caber. */
const ITEM_EXTRA_INDENT = 16

/** Uma linha de nome já posicionada: um item (branch ou tag) ou uma pasta da árvore. */
export type NameRow<T> =
  | { kind: 'item'; item: T; label: string; indent: number | undefined }
  | { kind: 'dir'; path: string; name: string; fileCount: number; indent: number; collapsed: boolean }

/** Árvore pelas barras do nome (feature/x vira a pasta feature). Só o modo árvore precisa dela. */
export function buildNameTree<T>(items: readonly T[], nameOf: (item: T) => string): TreeNode<T>[] {
  return buildTree(items, nameOf)
}

/** Modo lista: uma linha por item, na ordem dos dados, sem recuo. */
export function listNameRows<T>(items: readonly T[], nameOf: (item: T) => string): NameRow<T>[] {
  return items.map((item): NameRow<T> => ({ kind: 'item', item, label: nameOf(item), indent: undefined }))
}

/**
 * Modo árvore: as linhas visíveis de uma árvore já montada. Pasta recolhida (pelo caminho completo) esconde o que
 * está dentro dela. Cada seção tem a própria árvore e o próprio conjunto de pastas recolhidas.
 */
export function treeNameRows<T>(tree: readonly TreeNode<T>[], collapsed: ReadonlySet<string>): NameRow<T>[] {
  return flattenTree(tree, collapsed).map((row): NameRow<T> => {
    const indent = BASE_INDENT + TREE_INDENT * row.depth
    if (row.kind === 'file') return { kind: 'item', item: row.node.item, label: row.node.name, indent: indent + ITEM_EXTRA_INDENT }
    return { kind: 'dir', path: row.node.path, name: row.node.name, fileCount: row.node.fileCount, indent, collapsed: row.collapsed }
  })
}
