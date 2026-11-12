import { useAppActions, useRepoData } from '../context'
import { shortSha } from '../format'
import { t, type MessageKey } from '../i18n'

export const OPERATION_LABEL: Record<'merge' | 'cherry-pick' | 'revert' | 'rebase', MessageKey> = {
  merge: 'operation.merge',
  'cherry-pick': 'operation.cherryPick',
  revert: 'operation.revert',
  rebase: 'operation.rebase'
}

/**
 * Faixa só informativa da operação e dos conflitos: totais e situação curta. Tudo o que age (continuar, pular,
 * abortar, escolher um lado, resolver em lote, o editor) fica na tela Conflitos, que o clique na faixa abre.
 */
export function OperationBanner() {
  const { data } = useRepoData()
  const { setConflictsScreen } = useAppActions()
  const { operation, status } = data
  const conflicts = status.conflicted

  if (operation.kind === 'none' && conflicts.length === 0) return null

  const title =
    operation.kind === 'none'
      ? t('operation.conflictedFiles')
      : `${t(OPERATION_LABEL[operation.kind])}${operation.head ? ` — ${shortSha(operation.head)}` : ''}${
          operation.step ? ` ${t('operation.step', { step: operation.step, total: operation.total ?? 0 })}` : ''
        }`

  return (
    <div data-tour="conflicts" className={`operation-banner ${conflicts.length ? 'has-conflicts' : ''}`}>
      <button type="button" className="operation-title" title={t('conflictsScreen.open')} onClick={() => setConflictsScreen(true)}>
        <strong>{title}</strong>
        <span className="muted">
          {conflicts.length ? t('operation.conflictsHelp', { count: conflicts.length }) : t('operation.noConflicts')}
        </span>
      </button>
    </div>
  )
}
