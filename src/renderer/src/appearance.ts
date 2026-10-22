// Aplica na página as configurações visuais e de idioma (usado pela janela principal e pelas de diff).

import type { Settings } from '../../shared/settings'
import { insideVsCode, vsCodeTheme } from './vscodeBridge'
import { matchLocale, textDirection, type LocaleId } from './i18n'

export function resolveLocale(settings: Settings, systemLocales: readonly string[]): LocaleId {
  return settings.language === 'system' ? matchLocale(systemLocales) : settings.language
}

/** O tema está claro agora? (Para escolher a variante dos ícones de arquivo.) */
export function isLightTheme(): boolean {
  const root = document.documentElement
  if (root.dataset.vscodeColors === 'on') return vsCodeTheme() === 'light'
  if (root.dataset.theme === 'light') return true
  if (root.dataset.theme === 'dark') return false
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches
}

/** Avisa quando o tema muda (ajuste do GitTools, do sistema ou do VS Code). */
export function subscribeTheme(listener: () => void): () => void {
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-vscode-colors'] })
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null
  media?.addEventListener('change', listener)
  return () => {
    observer.disconnect()
    media?.removeEventListener('change', listener)
  }
}

let followTheme: (() => void) | null = null

/**
 * No VS Code, com o tema "do sistema", a interface usa as cores e as fontes do próprio VS Code (as variáveis
 * `--vscode-*`, que ele mantém atualizadas); a classe claro/escuro do `body` só indica `color-scheme`.
 */
function applyVsCodeLook(root: HTMLElement, settings: Settings) {
  const follow = insideVsCode() && settings.theme === 'system'
  if (follow) root.dataset.vscodeColors = 'on'
  else delete root.dataset.vscodeColors
  followTheme = follow ? () => (root.dataset.theme = vsCodeTheme() ?? 'dark') : null
}

if (typeof document !== 'undefined' && insideVsCode()) {
  // O VS Code troca as classes do body ao mudar de tema: acompanha sem recarregar o painel.
  new MutationObserver(() => followTheme?.()).observe(document.body, { attributes: true, attributeFilter: ['class'] })
}

/** Aplica tema, escala, idioma e direção do texto (o árabe é escrito da direita para a esquerda). */
export function applySettings(settings: Settings, locale: LocaleId, title = 'GitTools') {
  const root = document.documentElement
  applyVsCodeLook(root, settings)
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
