// Aplica na página as configurações visuais e de idioma (usado pela janela principal e pelas de diff).

import type { Settings } from '../../shared/settings'
import { vsCodeTheme } from './vscodeBridge'
import { matchLocale, textDirection, type LocaleId } from './i18n'

export function resolveLocale(settings: Settings, systemLocales: readonly string[]): LocaleId {
  return settings.language === 'system' ? matchLocale(systemLocales) : settings.language
}

/** Aplica tema, escala, idioma e direção do texto (o árabe é escrito da direita para a esquerda). */
export function applySettings(settings: Settings, locale: LocaleId, title = 'GitTools') {
  const root = document.documentElement
  // No VS Code, "do sistema" segue o tema do próprio VS Code.
  root.dataset.theme = settings.theme === 'system' ? (vsCodeTheme() ?? 'system') : settings.theme
  root.lang = locale
  root.dir = textDirection()
  root.style.setProperty('--divider-size', `${settings.dividerWidth}px`)
  root.style.setProperty('--pane-button-scale', String(settings.paneButtonScale))
  // Posição e tamanho das notificações (o CSS usa estes valores).
  root.dataset.toastX = settings.toast.horizontal
  root.dataset.toastY = settings.toast.vertical
  root.style.setProperty('--toast-width', `${settings.toast.width}px`)
  root.style.setProperty('--toast-height', `${settings.toast.height}px`)
  document.title = title
  window.gittools.setZoom(settings.zoom)
}
