import { useState } from 'react'
import { useApp } from '../context'
import { git } from '../git'
import { shortSha } from '../format'
import { t, type MessageKey } from '../i18n'
import { BULK_RESOLUTIONS, bulkHelp, bulkLabel, useResolveAll } from '../bulkConflicts'

const LABEL: Record<'merge' | 'cherry-pick' | 'revert' | 'rebase', MessageKey> = {
  merge: 'operation.merge',
  'cherry-pick': 'operation.cherryPick',
  revert: 'operation.revert',
  rebase: 'operation.rebase'
}

/** Acima deste número de arquivos em conflito aparece o campo de filtro por nome. */
const FILTER_FROM = 8

export function OperationBanner({ onShowChanges }: { onShowChanges(): void }) {
  const { data, run, confirm, openConflict, openInEditor } = useApp()
  const resolveAll = useResolveAll()
  const [filter, setFilter] = useState('')
  const { operation, status } = data
  const conflicts = status.conflicted
  if (operation.kind === 'none' && conflicts.length === 0) return null

  const title =
    operation.kind === 'none'
      ? t('operation.conflictedFiles')
      : `${t(LABEL[operation.kind])}${operation.head ? ` — ${shortSha(operation.head)}` : ''}${
          operation.step ? ` ${t('operation.step', { step: operation.step, total: operation.total ?? 0 })}` : ''
        }`

  const abort = async () => {
    const ok = await confirm({
      title: t('operation.abort'),
      message: operation.kind === 'none' ? t('operation.abortFilesMessage') : t('operation.abortMessage'),
      confirmLabel: t('operation.abort'),
      danger: true
    })
    if (ok) await run(t('busy.aborting'), () => git.abortOperation())
  }

  const resolve = (path: string, resolution: 'ours' | 'theirs' | 'resolved') =>
    run(t('busy.resolving'), () => git.resolveConflict(path, resolution))

  const needle = filter.trim().toLowerCase()
  const shown = needle ? conflicts.filter((f) => f.path.toLowerCase().includes(needle)) : conflicts

  return (
    <div className={`operation-banner ${conflicts.length ? 'has-conflicts' : ''}`}>
      <div className="operation-title">
        <strong>{title}</strong>
        <span className="muted">
          {conflicts.length ? t('operation.conflictsHelp', { count: conflicts.length }) : t('operation.noConflicts')}
        </span>
      </div>
      {conflicts.length > 0 && (
        <div className="conflict-panel">
          <div className="conflict-tools">
            {conflicts.length > FILTER_FROM && (
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
                <button key={resolution} title={t(bulkHelp(resolution))} onClick={() => resolveAll(resolution)}>
                  {t(bulkLabel(resolution))}
                </button>
              ))}
            </div>
          </div>
          <ul className="conflict-list">
            {shown.map((f) => (
              <li key={f.path}>
                <span className="conflict-path">{f.path}</span>
                <button className="primary" onClick={() => openConflict(f.path)} title={t('operation.sideBySideHelp')}>
                  {t('operation.sideBySide')}
                </button>
                <button onClick={() => openInEditor(f.path)}>{t('common.openInEditor')}</button>
                <button onClick={() => resolve(f.path, 'ours')} title={t('operation.useOursHelp')}>
                  {t('conflict.useOurs')}
                </button>
                <button onClick={() => resolve(f.path, 'theirs')} title={t('operation.useTheirsHelp')}>
                  {t('conflict.useTheirs')}
                </button>
                <button onClick={() => resolve(f.path, 'resolved')} title={t('operation.resolvedHelp')}>
                  ✓ {t('operation.resolved')}
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="muted small">{t('conflictBulk.noMatch')}</li>}
          </ul>
        </div>
      )}
      <div className="operation-actions">
        {operation.kind !== 'none' ? (
          <>
            <button className="primary" disabled={conflicts.length > 0} onClick={() => run(t('busy.continuing'), () => git.continueOperation())}>
              {t('operation.continue')}
            </button>
            {operation.kind !== 'merge' && (
              <button onClick={() => run(t('busy.skipping'), () => git.skipOperation())}>{t('operation.skip')}</button>
            )}
          </>
        ) : (
          <button onClick={onShowChanges}>{t('operation.showChanges')}</button>
        )}
        <button className="danger" onClick={abort}>
          {t('operation.abort')}
        </button>
      </div>
    </div>
  )
}
