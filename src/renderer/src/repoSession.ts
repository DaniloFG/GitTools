// Sessão de cada repositório aberto: os dados da última leitura, o que o usuário estava vendo (filtro, seleção,
// arquivo aberto…) e uma pequena máquina de estados que decide, ao voltar para a aba, se é preciso ler o
// repositório de novo. Assim, alternar entre abas de repositórios não refaz o que já foi carregado:
//
//   cold ──load──▶ loading ──loaded──▶ fresh ──(algo mudou)──▶ stale ──revalidate──▶ revalidating ──▶ fresh
//
//  - `fresh`: a geração do cache não mudou desde a leitura. Voltar para a aba não chama o git.
//  - `stale`: algo mudou (ou a tela passou a precisar de mais dados). A aba aparece na hora com os dados antigos
//    e a leitura nova acontece por trás, trocando os dados quando chega (stale-while-revalidate).
//  - `cold`: nunca foi lida (ou foi descartada para poupar memória): mostra o indicador de carregamento.
//
// A parte pura (estado e plano) não depende do React e é testada em tests/repoSession.test.ts.

import type { CompareRequest, RepoData } from './context'
import type { FileFocus, WipFocus } from './components/CommitDetails'
import type { HistoryScope, LogLimit } from './historyScope'
import type { LogCache } from './stable'

/** O que a tela precisa que esteja carregado, além do básico (status, branches, tags e operação). */
export interface Wants {
  /** Histórico de commits (painel Histórico ou Branches, que usa as cores do grafo). */
  log: boolean
  /** Stashes (painel Stashes ou dashboards). */
  stashes: boolean
  /**
   * Contagens de linhas (+/−) do status. Custam a leitura dos arquivos novos, então só as telas que as mostram pedem
   * (ver `wants.stats` em App.tsx); a leitura sem elas é a do caminho de atualização, com um processo só.
   */
  stats: boolean
}

/** O que a última leitura trouxe. */
export interface Loaded extends Wants {
  /** Geração do cache quando a leitura começou: se a atual for maior, algo mudou depois. */
  generation: number
  /** Filtro de branches do histórico usado na leitura. */
  scopeKey: string
}

export type SessionState = 'cold' | 'loading' | 'fresh' | 'stale' | 'revalidating'

export interface StateInput {
  hasData: boolean
  loaded: Loaded | null
  loading: boolean
  generation: number
  scopeKey: string
  wants: Wants
}

/** O dado guardado cobre o que a tela quer agora? (Um painel novo na tela pode pedir o histórico ou os stashes.) */
export function covers(loaded: Loaded, scope: string, wants: Wants): boolean {
  return loaded.scopeKey === scope && (loaded.log || !wants.log) && (loaded.stashes || !wants.stashes) && (loaded.stats || !wants.stats)
}

/** Estado da sessão neste instante (derivado: não existe "stale" gravado, ele nasce de a geração ter mudado). */
export function sessionState(input: StateInput): SessionState {
  const { hasData, loaded, loading, generation, scopeKey: scope, wants } = input
  if (!hasData || !loaded) return loading ? 'loading' : 'cold'
  if (loading) return 'revalidating'
  return loaded.generation === generation && covers(loaded, scope, wants) ? 'fresh' : 'stale'
}

/** O que fazer quando a aba é mostrada (ou a tela passa a pedir mais dados). */
export type Plan = 'use-cached' | 'revalidate' | 'load' | 'wait'

export function planFor(state: SessionState): Plan {
  switch (state) {
    case 'fresh':
      return 'use-cached'
    case 'stale':
      return 'revalidate'
    case 'cold':
      return 'load'
    // Já há uma leitura a caminho: entra nela em vez de começar outra.
    case 'loading':
    case 'revalidating':
      return 'wait'
  }
}

/** Estado de tela de um repositório que é lembrado ao sair da aba e devolvido ao voltar. */
export interface SessionUi {
  scope: HistoryScope
  selected: string[]
  fileFocus: FileFocus | null
  wipFocus: WipFocus | null
  compare: CompareRequest
  filePath: string | null
  /** Estado dos painéis (arquivo aberto, filtros…), por nome (ver `useSessionState`). */
  panes: Map<string, unknown>
}

export interface RepoSession {
  root: string
  data: RepoData | null
  loaded: Loaded | null
  /** Leitura em andamento (uma só por repositório, mesmo que a aba suma e volte). */
  inflight: Promise<void> | null
  /** Pedido de nova leitura que chegou durante a atual. */
  again: boolean
  /** Geração do cache quando a leitura em andamento começou; `null` quando não há leitura. */
  loadingGeneration: number | null
  logCache: LogCache | null
  /** Quantos commits do histórico (deste escopo) já foram pedidos; a página seguinte começa daí. */
  logLimit: LogLimit | null
  /**
   * Página do histórico em leitura. Enquanto ela existe, nenhuma leitura completa começa: senão uma delas poderia
   * gravar uma lista com o limite antigo por cima da página nova.
   */
  pagingLog: Promise<void> | null
  ui: SessionUi
  /** Quando a sessão foi usada pela última vez (para descartar as mais antigas). */
  touchedAt: number
}

const sessions = new Map<string, RepoSession>()

/** Quantas sessões mantêm dados (histórico, status…) em memória; as mais antigas voltam a `cold`. */
export const MAX_WARM_SESSIONS = 10

function blankUi(): SessionUi {
  return { scope: { kind: 'all' }, selected: [], fileFocus: null, wipFocus: null, compare: {}, filePath: null, panes: new Map() }
}

export function getSession(root: string): RepoSession {
  let session = sessions.get(root)
  if (!session) {
    session = {
      root,
      data: null,
      loaded: null,
      inflight: null,
      again: false,
      loadingGeneration: null,
      logCache: null,
      logLimit: null,
      pagingLog: null,
      ui: blankUi(),
      touchedAt: Date.now()
    }
    sessions.set(root, session)
  }
  session.touchedAt = Date.now()
  return session
}

/** O que é preciso saber para decidir se um aviso do observador é eco da alteração feita pela própria interface. */
export interface EchoInput {
  /**
   * A pasta .git mudou sem um comando próprio (o backend confere a assinatura da .git, ver gitSignature.ts). Quando
   * é true, nunca é eco, mesmo dentro da janela de alteração própria.
   */
  external: boolean
  /** Houve alteração própria recente (ver `ReadCache.hasRecentChange`). */
  ownChange: boolean
  /** Geração atual do repositório. */
  generation: number
  /** Geração da última leitura concluída, ou `null`. */
  lastLoaded: number | null
  /** Geração em que a leitura em andamento começou, ou `null`. */
  loadingGeneration: number | null
  /** Já há outra rodada de leitura na fila. */
  again: boolean
}

/**
 * O aviso é eco de uma alteração da própria interface, e os dados já foram lidos depois dela? Então não há o que
 * ler de novo. Sem alteração própria recente, nunca é eco: o aviso é de algo de fora (um commit no terminal).
 */
export function isOwnEcho(input: EchoInput): boolean {
  const { external, ownChange, generation, lastLoaded, loadingGeneration, again } = input
  // Mudança de fora dentro da janela de alteração própria: o carimbo não a explica, então não é eco.
  if (external || !ownChange) return false
  // Leitura em andamento: vale se começou depois da alteração, ou se outra rodada já vai começar depois dela.
  if (loadingGeneration !== null) return again || loadingGeneration === generation
  return lastLoaded === generation
}

export function peekSession(root: string): RepoSession | undefined {
  return sessions.get(root)
}

/** O repositório foi fechado. */
export function dropSession(root: string): void {
  sessions.delete(root)
}

/** Mantém só as `MAX_WARM_SESSIONS` mais recentes com dados; as outras perdem os dados (a tela de cada uma é preservada). */
export function trimSessions(keep: string, max = MAX_WARM_SESSIONS): string[] {
  const warm = [...sessions.values()].filter((s) => s.data !== null && s.root !== keep && s.inflight === null)
  const excess = warm.length + 1 - max
  if (excess <= 0) return []
  const dropped = warm.sort((a, b) => a.touchedAt - b.touchedAt).slice(0, excess)
  for (const s of dropped) {
    s.data = null
    s.loaded = null
    s.logCache = null
    s.logLimit = null
  }
  return dropped.map((s) => s.root)
}

/** Esquece tudo (testes). */
export function clearSessions(): void {
  sessions.clear()
}
