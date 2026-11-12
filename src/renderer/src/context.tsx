import { createContext, useContext, useMemo } from 'react'
import type { Settings } from '../../shared/settings'
import type { BranchInfo, CommitInfo, OperationState, RepoInfo, RepoStatus, StashInfo, TagInfo } from '../../shared/types'
import type { ChoiceRequest, ChoiceResult, ConfirmRequest, PromptRequest, PushRequest, PushResult } from './components/Dialogs'
import type { MenuItem } from './components/ContextMenu'
import type { DiffWindowRequest } from '../../shared/api'
import type { ScreenId, ViewId } from './dock'
import type { ToastAction, ToastKind } from './feedback'
import type { RepoSummary } from './workspace'

export type { ToastAction } from './feedback'

export interface RepoData {
  status: RepoStatus
  branches: BranchInfo[]
  tags: TagInfo[]
  stashes: StashInfo[]
  log: CommitInfo[]
  operation: OperationState
}

export type { ToastKind } from './feedback'

export interface StudioRequest {
  source?: string
  target?: string
  commits?: string[]
  mode?: 'branch' | 'commits' | 'files' | 'lines'
}

/** Telas que podem ser mostradas (cada uma é um conjunto de painéis que o usuário encaixa onde quiser). */
export type View = ScreenId

export interface CompareRequest {
  from?: string
  to?: string
}

/** Ações sobre as abas de repositórios (feitas pelo nível do app, que sabe de todos os abertos). */
export interface WorkspaceApi {
  /** Repositórios abertos nesta sessão, na ordem das abas. */
  repos: RepoInfo[]
  /** Resumo de cada um (branch, alterações, conflito, operação) para as abas e os menus. */
  summaries: Record<string, RepoSummary>
  /** Torna ativo um repositório aberto (espera as operações do atual terminarem). */
  activate(root: string): void
  /** Fecha um repositório só nesta sessão (pergunta antes se tem trabalho em aberto). */
  close(root: string): void
  /** Fecha os outros repositórios, mantendo `root`. */
  closeOthers(root: string): void
  /** Vai para a aba seguinte (1) ou anterior (-1), circularmente. */
  cycle(delta: 1 | -1): void
  /** Abre um repositório em nova aba (ou só ativa, se já está aberto); sem `path`, pergunta a pasta. */
  openRepo(path?: string, create?: boolean): void
  /** Abre o diálogo de clonar. */
  openClone(): void
  /** Aplica commits do repositório `sourceRoot` na branch atual de `targetRoot`, depois de confirmar. */
  applyAcross(sourceRoot: string, targetRoot: string, shas: string[]): void
}

/**
 * Fatia 1: dados do repositório aberto e as abas. Muda quando o Git é lido de novo (depois de cada operação e
 * a cada alteração na pasta `.git`), não a cada aviso nem a cada abertura de menu.
 */
export interface RepoDataValue {
  repo: RepoInfo
  /** Os outros repositórios abertos e as ações sobre as abas. */
  workspace: WorkspaceApi
  data: RepoData
}

/**
 * Fatia 2: a operação em andamento. Muda duas vezes em cada operação (início e fim), por isso fica separada dos
 * dados: quem só mostra dados não redesenha por causa dela.
 */
export interface BusyValue {
  /** Rótulo da operação em andamento (null = nenhuma). */
  busy: string | null
  /** Painéis que a operação em andamento mexe nos dados: são cobertos pelo indicador de carregamento. */
  busyScope: readonly ViewId[]
}

/**
 * Fatia 3: as ações. O valor só muda quando o idioma ou o repositório ativo muda, por isso um menu ou um botão que
 * só chama função não redesenha quando os dados ou a operação mudam.
 */
export interface AppActions {
  refresh(): Promise<void>
  /**
   * Executa uma operação mostrando progresso, erros e resultado, e atualiza a tela no fim.
   * `scope`: painéis que a operação atinge (padrão: todos os que mostram dados do repositório).
   * `options.queue`: espera as operações em andamento terminarem, em vez de ser descartada (ver `singleFlight.ts`).
   */
  run<T>(label: string, fn: () => Promise<T>, scope?: readonly ViewId[], options?: { queue?: boolean }): Promise<T | undefined>
  /** Aviso; com mais de um repositório aberto, cita o repositório (ver `prefixToast`). */
  toast(kind: ToastKind, text: string, action?: ToastAction): void
  confirm(request: ConfirmRequest): Promise<boolean>
  prompt(request: PromptRequest): Promise<string | null>
  choose(request: ChoiceRequest): Promise<ChoiceResult | null>
  /** Pergunta o remote e o modo (normal ou force) de um push. */
  askPush(request: PushRequest): Promise<PushResult | null>
  showMenu(event: React.MouseEvent, items: MenuItem[]): void
  openStudio(request: StudioRequest): void
  selectCommit(sha: string): void
  /** Mostra o commit nos painéis de commit (descrição, arquivos e diff), sem trocar de tela. */
  showCommit(sha: string): void
  setDashboards(open: boolean): void
  /** Abre ou fecha a tela Conflitos (ocupa o lugar dos painéis, como os Dashboards). */
  setConflictsScreen(open: boolean): void
  /** Traz à frente os painéis da tela, onde quer que estejam (mostrando os que estavam escondidos). */
  setView(view: View): void
  /** Abre o diff de um arquivo numa janela própria do sistema. */
  openDiffWindow(request: DiffWindowRequest): void
  /** Volta todos os painéis, abas e colunas às posições e tamanhos padrão. Pergunta antes de voltar tudo ao padrão. */
  resetLayout(): void | Promise<void>
  /** Abre o editor de conflitos lado a lado para um arquivo. */
  openConflict(path: string): void
  openCompare(request: CompareRequest): void
  /** Abre blame e histórico de um arquivo. */
  openFileView(path: string): void
  /** Abre o rebase interativo a partir de um commit (inclusive). */
  openRebase(sha: string): void
  /** Abre um arquivo (ou o repositório inteiro, sem caminho) no editor escolhido nas configurações. */
  openInEditor(path?: string): void
  /** Abre a Central de Configurações, opcionalmente numa seção (ex.: "shortcuts"). */
  openSettings(section?: string): void
  openShortcuts(): void
}

/**
 * Fatia 4: configurações do app e as telas que ocupam o lugar dos painéis (Dashboards e Conflitos). Muda ao salvar uma
 * configuração ou ao abrir/fechar uma delas.
 */
export interface AppSettingsValue {
  settings: Settings
  /** A tela de Dashboards está aberta (ocupa o lugar dos painéis). */
  dashboardsOpen: boolean
  /** A tela Conflitos está aberta (ocupa o lugar dos painéis). */
  conflictsOpen: boolean
}

/**
 * Valor combinado das quatro fatias. Quem lê `useApp()` recebe tudo isto e redesenha com qualquer mudança;
 * código novo deve usar o hook mais estreito (`useRepoData`, `useBusy`, `useAppActions`, `useAppSettings`).
 */
export type AppContextValue = RepoDataValue & BusyValue & AppActions & AppSettingsValue

/** Um contexto por fatia: cada hook só redesenha quando a fatia que ele lê muda. */
export const RepoDataContext = createContext<RepoDataValue | null>(null)
export const BusyContext = createContext<BusyValue | null>(null)
export const AppActionsContext = createContext<AppActions | null>(null)
export const AppSettingsContext = createContext<AppSettingsValue | null>(null)

/**
 * Valor combinado inteiro. O `App` continua fornecendo este contexto para quem ainda lê `useContext(AppContext)`
 * direto (Dock, diálogos, divisores, o diff). A janela de diff fornece só este, por isso `useApp` cai nele.
 */
export const AppContext = createContext<AppContextValue | null>(null)

/** Dados do repositório e as abas. Lança erro fora do provedor. */
export function useRepoData(): RepoDataValue {
  const value = useContext(RepoDataContext)
  if (!value) throw new Error('useRepoData fora do provedor')
  return value
}

/** Operação em andamento (rótulo e painéis cobertos). Lança erro fora do provedor. */
export function useBusy(): BusyValue {
  const value = useContext(BusyContext)
  if (!value) throw new Error('useBusy fora do provedor')
  return value
}

/** Ações (funções) estáveis enquanto o idioma e o repositório ativo não mudam. Lança erro fora do provedor. */
export function useAppActions(): AppActions {
  const value = useContext(AppActionsContext)
  if (!value) throw new Error('useAppActions fora do provedor')
  return value
}

/** Configurações e a tela de Dashboards. Lança erro fora do provedor. */
export function useAppSettings(): AppSettingsValue {
  const value = useContext(AppSettingsContext)
  if (!value) throw new Error('useAppSettings fora do provedor')
  return value
}

/**
 * Valor combinado das quatro fatias, com o mesmo tipo de sempre. ATENÇÃO: redesenha com qualquer mudança em
 * qualquer fatia. Código novo deve usar o hook mais estreito. Se as fatias não existem (a janela de diff fornece
 * só `AppContext`), usa o valor de `AppContext`, como antes da divisão.
 */
export function useApp(): AppContextValue {
  const repoData = useContext(RepoDataContext)
  const busy = useContext(BusyContext)
  const actions = useContext(AppActionsContext)
  const settings = useContext(AppSettingsContext)
  const legacy = useContext(AppContext)
  // Monta o objeto só quando alguma fatia muda: o retorno é estável enquanto nada muda.
  const combined = useMemo<AppContextValue | null>(
    () => (repoData && busy && actions && settings ? { ...repoData, ...busy, ...actions, ...settings } : null),
    [repoData, busy, actions, settings]
  )
  const value = combined ?? legacy
  if (!value) throw new Error('useApp fora do AppContext')
  return value
}

export function currentBranch(data: RepoData): string | null {
  return data.status.detached ? null : data.status.branch
}
