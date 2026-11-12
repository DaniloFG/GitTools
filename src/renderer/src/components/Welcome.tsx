import type { RecentRepo } from '../../../shared/api'
import type { Settings } from '../../../shared/settings'
import { relativeDate } from '../format'
import { t } from '../i18n'
import { useRecentRepos } from '../recent'
import { Loader } from './Loader'
import { SponsorNote } from './Sponsor'

interface Props {
  loading: boolean
  onOpen(path?: string, create?: boolean): void
  onClone(): void
  onSettings(): void
  /** Estado do convite ao Tour (`Settings.tourOffer`). */
  tourOffer: Settings['tourOffer']
  /** Resposta ao convite: aceitar grava `accepted` e abre o Tour; recusar grava `dismissed`. */
  onTourInvite(accept: boolean): void
  /** Botão "Tour": só abre o Tour, sem mexer no convite. */
  onTour(): void
}

/** Convite ao Tour: cartão pequeno abaixo dos botões. Quem o mostra decide quando (ver `Welcome`). */
function TourInvite({ onAnswer }: { onAnswer(accept: boolean): void }) {
  return (
    <div className="tour-invite" role="group" aria-label={t('tour.invite.title')}>
      <strong>{t('tour.invite.title')}</strong>
      <div className="tour-invite-actions">
        <button className="primary" onClick={() => onAnswer(true)}>
          {t('tour.invite.accept')}
        </button>
        <button onClick={() => onAnswer(false)}>{t('tour.invite.dismiss')}</button>
      </div>
    </div>
  )
}

export function Welcome({ loading, onOpen, onClone, onSettings, tourOffer, onTourInvite, onTour }: Props) {
  const { loaded, favorites, others, setFavorite, remove } = useRecentRepos()

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
              <button className="primary large" data-tour="open" onClick={() => onOpen()}>
                {t('toolbar.openRepository')}
              </button>
              <button className="large" onClick={() => onOpen(undefined, true)}>
                {t('toolbar.createRepository')}
              </button>
              <button className="large" data-tour="clone" onClick={onClone}>
                ⇣ {t('clone.menu')}
              </button>
              <button className="large" data-tour="settings" onClick={onSettings} title={t('toolbar.settings')}>
                ⚙ {t('toolbar.settings')}
              </button>
              <button className="large" onClick={onTour}>
                {t('tour.button')}
              </button>
            </div>
            {/* Só com o convite pendente e sem repositório recente; antes da primeira leitura da lista o cartão não pisca. */}
            {tourOffer === 'pending' && loaded && favorites.length + others.length === 0 && <TourInvite onAnswer={onTourInvite} />}
            {group(t('welcome.favorites'), favorites)}
            {group(t('welcome.recent'), others)}
            <SponsorNote />
          </>
        )}
      </div>
    </div>
  )
}
