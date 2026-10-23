// Definição dos widgets (gráficos) dos dashboards e do contexto que cada um recebe.

import type { ReactNode } from 'react'
import type { BranchInfo, GitCommandEntry, StashInfo, TagInfo } from '../../../../shared/types'
import type { MessageKey } from '../../i18n'
import type { TableData } from '../charts/DataTable'
import type { Granularity } from '../metrics'
import type { Commit, Dataset, Person } from '../model'

export type WidgetCategory = 'summary' | 'people' | 'code' | 'time' | 'quality' | 'repo' | 'tool'

export const CATEGORIES: WidgetCategory[] = ['summary', 'people', 'code', 'time', 'quality', 'repo', 'tool']

/** Formas de mostrar o mesmo dado (o rótulo de cada uma está em `dash.views.*`). */
export type ViewId =
  | 'tiles'
  | 'area'
  | 'line'
  | 'bar'
  | 'step'
  | 'stream'
  | 'stacked'
  | 'grouped'
  | 'list'
  | 'lollipop'
  | 'columns'
  | 'donut'
  | 'waffle'
  | 'treemap'
  | 'heatmap'
  | 'punch'
  | 'calendar'
  | 'radar'
  | 'scatter'
  | 'funnel'
  | 'gauge'
  | 'meter'
  | 'timeline'
  | 'table'

export interface WidgetOption {
  key: string
  label: MessageKey
  values: { id: string; label: MessageKey }[]
}

export interface Ctx {
  ds: Dataset
  /** Commits do período e dos filtros escolhidos (do mais antigo ao mais novo). */
  cs: Commit[]
  /** Commits do período anterior, de mesma duração (para as variações). */
  prev: Commit[]
  range: { from: number; to: number }
  g: Granularity
  /** Pessoas do período, da que mais commitou para a que menos. */
  people: Person[]
  name(id: string): string
  color(id: string): string
  /** Estado atual do repositório (branches, tags, stashes) e comandos que o GitTools executou. */
  branches: BranchInfo[]
  tags: TagInfo[]
  stashes: StashInfo[]
  commands: GitCommandEntry[]
  head: string | null
  now: number
}

export interface WidgetDef<D = unknown> {
  id: string
  category: WidgetCategory
  /** Formas de ver (a primeira é a padrão). */
  views: ViewId[]
  /** Colunas de 12 que o cartão ocupa por padrão e quantas linhas de altura. */
  cols: 3 | 4 | 6 | 8 | 12
  rows: 1 | 2 | 3
  options?: WidgetOption[]
  /** Calcula o que o gráfico mostra (só roda quando os dados ou o filtro mudam). */
  data(ctx: Ctx, options: Record<string, string>): D
  render(d: D, view: ViewId, ctx: Ctx, options: Record<string, string>): ReactNode
  table(d: D, ctx: Ctx, options: Record<string, string>): TableData
  /** Sem dados: o cartão mostra o aviso de vazio em vez do gráfico. */
  empty?(d: D): boolean
}

export interface WidgetInstance {
  /** Identificador desta ocorrência (o mesmo gráfico pode aparecer mais de uma vez). */
  uid: string
  widget: string
  view: ViewId
  options?: Record<string, string>
  cols?: 3 | 4 | 6 | 8 | 12
  rows?: 1 | 2 | 3
}
