import { useEffect, useState } from 'react'
import type { RecentRepo } from '../../../shared/api'
import { relativeDate } from '../format'

interface Props {
  loading: boolean
  onOpen(path?: string, create?: boolean): void
  onSettings(): void
}

export function Welcome({ loading, onOpen, onSettings }: Props) {
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
        <p className="muted">Git sem complicação: arraste e clique para fazer merge, rebase e cherry-pick de branches, commits, arquivos e até linhas.</p>
        {loading ? (
          <p>
            <span className="spinner" /> Carregando repositório…
          </p>
        ) : (
          <>
            <div className="welcome-actions">
              <button className="primary large" onClick={() => onOpen()}>
                Abrir repositório…
              </button>
              <button className="large" onClick={() => onOpen(undefined, true)}>
                Criar repositório…
              </button>
              <button className="large icon-button" onClick={onSettings} title="Configurações">
                ⚙
              </button>
            </div>
            {recent.length > 0 && (
              <>
                <h3>Recentes</h3>
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
