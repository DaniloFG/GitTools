import { createContext, useContext } from 'react'
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

export interface AppContextValue {
  repo: RepoInfo
  /** Os outros repositórios abertos e as ações sobre as abas. */
  workspace: WorkspaceApi
  data: RepoData
  /** Rótulo da operação em andamento (null = nenhuma). */
  busy: string | null
  /** Painéis que a operação em andamento mexe nos dados: são cobertos pelo indicador de carregamento. */
  busyScope: readonly ViewId[]
  refresh(): Promise<void>
  /**
   * Executa uma operação mostrando progresso, erros e resultado, e atualiza a tela no fim.
   * `scope`: painéis que a operação atinge (padrão: todos os que mostram dados do repositório).
   */
  run<T>(label: string, fn: () => Promise<T>, scope?: readonly ViewId[]): Promise<T | undefined>
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
  /** A tela de Dashboards está aberta (ocupa o lugar dos painéis). */
  dashboardsOpen: boolean
  setDashboards(open: boolean): void
  /** Traz à frente os painéis da tela, onde quer que estejam (mostrando os que estavam escondidos). */
  setView(view: View): void
  /** Abre o diff de um arquivo numa janela própria do sistema. */
  openDiffWindow(request: DiffWindowRequest): void
  /** Volta todos os painéis, abas e colunas às posições e tamanhos padrão. */
  /** Pergunta antes de voltar tudo ao padrão. */
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
  settings: Settings
  /** Abre a Central de Configurações, opcionalmente numa seção (ex.: "shortcuts"). */
  openSettings(section?: string): void
  openShortcuts(): void
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp fora do AppContext')
  return value
}

export function currentBranch(data: RepoData): string | null {
  return data.status.detached ? null : data.status.branch
}
