import type { BulkResolutionResult, ConflictResolution } from '../../shared/types'
import { useApp } from './context'
import { git } from './git'
import { t, type MessageKey } from './i18n'

/** Quantos caminhos aparecem na mensagem de falhas (o resto é resumido com reticências). */
const LISTED = 5

interface BulkAction {
  label: MessageKey
  help: MessageKey
  confirmTitle: MessageKey
  confirm: MessageKey
  /** Descarta edições feitas à mão (ours/theirs reescrevem o arquivo). */
  danger: boolean
}

const ACTIONS: Record<ConflictResolution, BulkAction> = {
  ours: {
    label: 'conflictBulk.keepOurs',
    help: 'conflictBulk.keepOursHelp',
    confirmTitle: 'conflictBulk.confirmOursTitle',
    confirm: 'conflictBulk.confirmOurs',
    danger: true
  },
  theirs: {
    label: 'conflictBulk.takeTheirs',
    help: 'conflictBulk.takeTheirsHelp',
    confirmTitle: 'conflictBulk.confirmTheirsTitle',
    confirm: 'conflictBulk.confirmTheirs',
    danger: true
  },
  resolved: {
    label: 'conflictBulk.markResolved',
    help: 'conflictBulk.markResolvedHelp',
    confirmTitle: 'conflictBulk.confirmResolvedTitle',
    confirm: 'conflictBulk.confirmResolved',
    danger: false
  }
}

/** Ordem das ações em lote nos menus e barras. */
export const BULK_RESOLUTIONS: readonly ConflictResolution[] = ['ours', 'theirs', 'resolved']

export const bulkLabel = (resolution: ConflictResolution): MessageKey => ACTIONS[resolution].label
export const bulkHelp = (resolution: ConflictResolution): MessageKey => ACTIONS[resolution].help

/**
 * Resolve todos os arquivos em conflito do repositório, depois de pedir confirmação com a quantidade.
 * Devolve undefined se o usuário desistir ou não houver conflitos.
 */
export function useResolveAll() {
  const { data, run, confirm, toast } = useApp()

  return async (resolution: ConflictResolution): Promise<BulkResolutionResult | undefined> => {
    const paths = data.status.conflicted.map((f) => f.path)
    if (paths.length === 0) return undefined
    const action = ACTIONS[resolution]
    const ok = await confirm({
      title: t(action.confirmTitle),
      message: t(action.confirm, { count: paths.length }),
      confirmLabel: t(action.label),
      danger: action.danger
    })
    if (!ok) return undefined

    const result = await run(t('busy.resolving'), () => git.resolveConflicts(paths, resolution))
    if (!result) return undefined
    if (result.failed.length === 0) {
      toast('success', t('conflictBulk.done', { count: result.resolved }))
    } else {
      const names = result.failed.map((f) => f.path)
      const list = names.slice(0, LISTED).join(', ') + (names.length > LISTED ? ' …' : '')
      toast('warning', t('conflictBulk.partial', { resolved: result.resolved, failed: result.failed.length, list }))
    }
    return result
  }
}
