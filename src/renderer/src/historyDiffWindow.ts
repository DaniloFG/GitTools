// Pedido de "Open in new window" a partir do diff de um commit no History. Lógica pura, sem React, para ser testada.
import type { DiffWindowRequest } from '../../shared/api'
import type { DiffLayout } from '../../shared/settings'

/**
 * Modo (lado a lado ou cima e baixo) do diff do History que está na tela agora. A escolha do menu ⋯ vive no estado do
 * `DiffView` (`useDiffLayout`), longe de quem abre a janela (o painel de detalhes e a lista de arquivos do histórico,
 * que fica em outra árvore); o DiffView do History a registra aqui e o clique lê o valor na hora. Variável de módulo e
 * não store: ninguém precisa redesenhar com ela, e não há leitura nem escrita em disco por evento.
 */
let onScreen: DiffLayout | undefined

/** Chamado pelo DiffView do History: o modo de agora, ou `undefined` quando ele sai da tela (a escolha morre com ele). */
export function reportHistoryDiffLayout(layout: DiffLayout | undefined): void {
  onScreen = layout
}

/** Modo do diff do History na tela, ou `undefined` se não há nenhum (a janela então segue as configurações). */
export function historyDiffLayout(): DiffLayout | undefined {
  return onScreen
}

/**
 * Pedido da janela para o arquivo de um commit. `layout` só entra quando há um: Compare, Changes e o histórico de
 * arquivo não o passam, e a janela lê o `diffLayout` das configurações quando ele falta.
 */
export function commitDiffWindowRequest(args: { sha: string; path: string; oldPath?: string; title: string; layout?: DiffLayout }): DiffWindowRequest {
  const { sha, path, oldPath, title, layout } = args
  return { source: { kind: 'commit', sha, oldPath }, path, title, ...(layout ? { layout } : {}) }
}
