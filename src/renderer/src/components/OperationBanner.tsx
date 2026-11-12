import { useMemo, useState } from 'react'
import { useAppActions, useAppSettings, useRepoData } from '../context'
import { shortSha } from '../format'
import { t, type MessageKey } from '../i18n'
import { BULK_RESOLUTIONS, bulkHelp, bulkLabel } from '../bulkConflicts'
import { useConflictFlow } from './ConflictFlow'

export const OPERATION_LABEL: Record<'merge' | 'cherry-pick' | 'revert' | 'rebase', MessageKey> = {
  merge: 'operation.merge',
  'cherry-pick': 'operation.cherryPick',
  revert: 'operation.revert',
  rebase: 'operation.rebase'
}

/** Acima deste número de arquivos em conflito aparece o campo de filtro por nome. */
const FILTER_FROM = 8

/**
 * Faixa informativa da operação e dos conflitos. Continuar, pular, abortar, "continuar automaticamente" e a linha de
 * reaproveitar decisões ficam na tela Conflitos (clique na faixa de título); aqui só restam as ações por arquivo e
 * o lote. O estado compartilhado (decisões lembradas, ações) vem de `ConflictFlowProvider`.
 */
export function OperationBanner() {
  const { data } = useRepoData()
  const { openConflict, openInEditor, setConflictsScreen } = useAppActions()
  const { resolve, resolveEvery } = useConflictFlow()
  // Com a tela Conflitos aberta, o filtro e a lista por arquivo ficam só nela: aqui sobra a faixa e o "Resolver todos".
  const { conflictsOpen } = useAppSettings()
  const [filter, setFilter] = useState('')
  const { operation, status } = data
  const conflicts = status.conflicted

  const needle = filter.trim().toLowerCase()
  // A lista só existe com a tela fechada: com ela aberta, nada é filtrado.
  const shown = useMemo(
    () => (conflictsOpen || !needle ? conflicts : conflicts.filter((f) => f.path.toLowerCase().includes(needle))),
    [conflicts, conflictsOpen, needle]
  )

  if (operation.kind === 'none' && conflicts.length === 0) return null

  const title =
    operation.kind === 'none'
      ? t('operation.conflictedFiles')
      : `${t(OPERATION_LABEL[operation.kind])}${operation.head ? ` — ${shortSha(operation.head)}` : ''}${
          operation.step ? ` ${t('operation.step', { step: operation.step, total: operation.total ?? 0 })}` : ''
        }`

  return (
    <div className={`operation-banner ${conflicts.length ? 'has-conflicts' : ''}`}>
      <button type="button" className="operation-title" title={t('conflictsScreen.open')} onClick={() => setConflictsScreen(true)}>
        <strong>{title}</strong>
        <span className="muted">
          {conflicts.length ? t('operation.conflictsHelp', { count: conflicts.length }) : t('operation.noConflicts')}
        </span>
      </button>
      {conflicts.length > 0 && (
        <div className="conflict-panel">
          <div className="conflict-tools">
            {!conflictsOpen && conflicts.length > FILTER_FROM && (
              <>
                <input
                  type="search"
                  className="conflict-filter"
                  value={filter}
                  placeholder={t('conflictBulk.filterPlaceholder')}
                  aria-label={t('conflictBulk.filterLabel')}
                  onChange={(e) => setFilter(e.target.value)}
                />
                {needle && <span className="muted small">{t('conflictBulk.showing', { shown: shown.length, count: conflicts.length })}</span>}
              </>
            )}
            <div className="conflict-bulk" role="group" aria-label={t('conflictBulk.title')}>
              <span className="muted small">{t('conflictBulk.resolveAllLabel')}</span>
              {BULK_RESOLUTIONS.map((resolution) => (
                <button key={resolution} title={t(bulkHelp(resolution))} onClick={() => void resolveEvery(resolution)}>
                  {t(bulkLabel(resolution))}
                </button>
              ))}
            </div>
          </div>
          {/* Exceção à regra de janela: a lista cresce com os conflitos e rola num box de altura máxima. A tela Conflitos
              (VirtualList) já tem a lista em janela; as ações por arquivo saem daqui em E9 (docs/ESBOCO-CONFLITOS.md). */}
          {!conflictsOpen && (
            <ul className="conflict-list">
              {shown.map((f) => (
                <li key={f.path}>
                  <span className="conflict-path">{f.path}</span>
                  <button className="primary" onClick={() => openConflict(f.path)} title={t('operation.sideBySideHelp')}>
                    {t('operation.sideBySide')}
                  </button>
                  <button onClick={() => openInEditor(f.path)}>{t('common.openInEditor')}</button>
                  <button onClick={() => void resolve(f.path, 'ours')} title={t('operation.useOursHelp')}>
                    {t('conflict.useOurs')}
                  </button>
                  <button onClick={() => void resolve(f.path, 'theirs')} title={t('operation.useTheirsHelp')}>
                    {t('conflict.useTheirs')}
                  </button>
                  <button onClick={() => void resolve(f.path, 'resolved')} title={t('operation.resolvedHelp')}>
                    ✓ {t('operation.resolved')}
                  </button>
                </li>
              ))}
              {shown.length === 0 && <li className="muted small">{t('conflictBulk.noMatch')}</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
