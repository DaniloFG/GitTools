import { useEffect, useState } from 'react'
import type { RecentRepo } from '../../../shared/api'
import { relativeDate } from '../format'
import { t } from '../i18n'

interface Props {
  loading: boolean
  onOpen(path?: string, create?: boolean): void
  onClone(): void
  onSettings(): void
}

export function Welcome({ loading, onOpen, onClone, onSettings }: Props) {
  const [recent, setRecent] = useState<RecentRepo[]>([])
  useEffect(() => {
    window.gittools.recentRepositories().then(setRecent, () => setRecent([]))
  }, [])

  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="logo">
          <span className="logo-mark">⑂</span> GitTools
        </div>
        <p className="muted">{t('welcome.tagline')}</p>
        {loading ? (
          <p>
            <span className="spinner" /> {t('welcome.loading')}
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
            {recent.length > 0 && (
              <>
                <h3>{t('welcome.recent')}</h3>
                <ul className="recent-list">
                  {recent.map((r) => (
                    <li key={r.path}>
                      <button onClick={() => onOpen(r.path)}>
                        <strong>{r.name}</strong>
                        <span className="muted">{r.path}</span>
                        <small className="muted">{relativeDate(r.openedAt)}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
