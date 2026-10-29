import type { RecentRepo } from '../../../shared/api'
import { relativeDate } from '../format'
import { t } from '../i18n'
import { useRecentRepos } from '../recent'
import { Loader } from './Loader'

interface Props {
  loading: boolean
  onOpen(path?: string, create?: boolean): void
  onClone(): void
  onSettings(): void
}

export function Welcome({ loading, onOpen, onClone, onSettings }: Props) {
  const { favorites, others, setFavorite, remove } = useRecentRepos()

  const group = (title: string, list: RecentRepo[]) =>
    list.length > 0 && (
      <>
        <h3>{title}</h3>
        <ul className="recent-list">
          {list.map((r) => (
            <li key={r.path}>
              <button className="recent-open" onClick={() => onOpen(r.path)}>
                <strong>{r.name}</strong>
                <span className="muted">{r.path}</span>
                <small className="muted">{relativeDate(r.openedAt)}</small>
              </button>
              <button
                className={`recent-action ${r.favorite ? 'active' : ''}`}
                title={r.favorite ? t('welcome.unfavorite') : t('welcome.favorite')}
                aria-label={r.favorite ? t('welcome.unfavorite') : t('welcome.favorite')}
                onClick={() => void setFavorite(r.path, !r.favorite)}
              >
                {r.favorite ? '★' : '☆'}
              </button>
              <button className="recent-action" title={t('welcome.removeRecent')} aria-label={t('welcome.removeRecent')} onClick={() => void remove(r.path)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      </>
    )

  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="logo">
          <span className="logo-mark">⑂</span> GitTools
        </div>
        <p className="muted">{t('welcome.tagline')}</p>
        {loading ? (
          <p>
            <Loader size="sm" label={t('welcome.loading')} />
          </p>
        ) : (
          <>
            <div className="welcome-actions">
              <button className="primary large" onClick={() => onOpen()}>
                {t('toolbar.openRepository')}
              </button>
              <button className="large" onClick={() => onOpen(undefined, true)}>
                {t('toolbar.createRepository')}
              </button>
              <button className="large" onClick={onClone}>
                ⇣ {t('clone.menu')}
              </button>
              <button className="large" onClick={onSettings} title={t('toolbar.settings')}>
                ⚙ {t('toolbar.settings')}
              </button>
            </div>
            {group(t('welcome.favorites'), favorites)}
            {group(t('welcome.recent'), others)}
          </>
        )}
      </div>
    </div>
  )
}
