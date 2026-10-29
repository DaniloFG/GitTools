import { createContext, useContext } from 'react'
import type { Settings } from '../../shared/settings'
import type { BranchInfo, CommitInfo, OperationState, RepoInfo, RepoStatus, StashInfo, TagInfo } from '../../shared/types'
import type { ChoiceRequest, ChoiceResult, ConfirmRequest, PromptRequest, PushRequest, PushResult } from './components/Dialogs'
import type { MenuItem } from './components/ContextMenu'
import type { DiffWindowRequest } from '../../shared/api'
import type { ScreenId, ViewId } from './dock'

export interface RepoData {
  status: RepoStatus
  branches: BranchInfo[]
  tags: TagInfo[]
  stashes: StashInfo[]
  log: CommitInfo[]
  operation: OperationState
}

export type ToastKind = 'success' | 'error' | 'warning' | 'info'

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

export interface AppContextValue {
  repo: RepoInfo
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
  toast(kind: ToastKind, text: string): void
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
