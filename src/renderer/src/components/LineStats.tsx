import type { LineStats as Stats } from '../../../shared/types'
import { t } from '../i18n'

/** "+12 −3" de um arquivo (ou "binário"); nada quando as linhas não foram contadas. */
export function LineStats({ stats }: { stats: Stats }) {
  if (stats.binary) return <span className="line-stats binary">{t('diffExtra.binary')}</span>
  if (stats.additions === undefined && stats.deletions === undefined) return null
  const additions = stats.additions ?? 0
  const deletions = stats.deletions ?? 0
  return (
    <span className="line-stats" dir="ltr" title={t('diffExtra.linesTitle', { additions, deletions })}>
      <span className="add">+{additions}</span>
      <span className="del">−{deletions}</span>
    </span>
  )
}
