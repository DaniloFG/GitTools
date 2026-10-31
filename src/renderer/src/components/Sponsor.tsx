import { SPONSOR_URL } from '../../../shared/links'
import { t } from '../i18n'

/**
 * Link para o GitHub Sponsors com cara de botão. É um `<a target="_blank">` de propósito: no app o Electron
 * manda a nova janela para o navegador (setWindowOpenHandler) e no webview do VS Code o clique em link
 * externo também é aberto fora, coisa que `window.open` não garante.
 */
export function SponsorButton({ compact = false }: { compact?: boolean }) {
  return (
    <a
      className={`sponsor-button${compact ? ' compact' : ''}`}
      href={SPONSOR_URL}
      target="_blank"
      rel="noreferrer"
      title={t('sponsor.help')}
      aria-label={compact ? t('sponsor.button') : undefined}
    >
      <span className="sponsor-heart" aria-hidden>
        ♥
      </span>
      {!compact && t('sponsor.button')}
    </a>
  )
}

/** Convite para apoiar o projeto: a frase e o botão (tela inicial e Configurações → Sobre). */
export function SponsorNote() {
  return (
    <div className="sponsor-note">
      <span>{t('sponsor.message')}</span>
      <SponsorButton />
    </div>
  )
}
