import { createContext, useContext } from 'react'
import type { Settings } from '../../shared/settings'
import type { BranchInfo, CommitInfo, OperationState, RepoInfo, RepoStatus, StashInfo, TagInfo } from '../../shared/types'
import type { ChoiceRequest, ChoiceResult, ConfirmRequest, PromptRequest } from './components/Dialogs'
import type { MenuItem } from './components/ContextMenu'
import type { DiffWindowRequest } from '../../shared/api'
import type { ViewId } from './workbench'

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

/** Telas que podem ser mostradas (cada uma é uma aba numa das áreas da janela). */
export type View = ViewId

export interface CompareRequest {
  from?: string
  to?: string
}

export interface AppContextValue {
  repo: RepoInfo
  data: RepoData
  busy: string | null
  refresh(): Promise<void>
  /** Executa uma operação mostrando progresso, erros e resultado, e atualiza a tela no fim. */
  run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined>
  toast(kind: ToastKind, text: string): void
  confirm(request: ConfirmRequest): Promise<boolean>
  prompt(request: PromptRequest): Promise<string | null>
  choose(request: ChoiceRequest): Promise<ChoiceResult | null>
  showMenu(event: React.MouseEvent, items: MenuItem[]): void
  openStudio(request: StudioRequest): void
  selectCommit(sha: string): void
  /** Mostra a tela (na área onde ela estiver), expandindo a área se estiver recolhida. */
  setView(view: View): void
  /** Abre o diff de um arquivo numa janela própria do sistema. */
  openDiffWindow(request: DiffWindowRequest): void
  /** Volta todos os painéis, abas e colunas às posições e tamanhos padrão. */
  resetLayout(): void
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
