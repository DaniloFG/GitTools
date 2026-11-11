// Aplica na página as configurações visuais e de idioma (usado pela janela principal e pelas de diff).

import { useReducer } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'
import { insideVsCode, vsCodeTheme } from './vscodeBridge'
import { getLocale, loadFallbacks, loadLocale, matchLocale, setDateFormat, setLocale, textDirection, type LocaleId } from './i18n'

export function resolveLocale(settings: Settings, systemLocales: readonly string[]): LocaleId {
  return settings.language === 'system' ? matchLocale(systemLocales) : settings.language
}

/** Configurações lidas antes do primeiro desenho (ver `bootLocale`); o App começa com elas, não com as padrão. */
let boot: Settings = DEFAULT_SETTINGS

export function bootSettings(): Settings {
  return boot
}

/**
 * Antes do primeiro desenho: lê as configurações e espera o catálogo do idioma delas, para a
 * tela nunca mostrar chaves cruas nem trocar de idioma logo depois de aparecer. Em "sistema" usa os idiomas do
 * navegador, como o primeiro desenho do App (pedir `appInfo` aqui atrasaria a tela pela versão do git).
 */
export async function bootLocale(): Promise<void> {
  boot = await window.gittools.getSettings().catch(() => DEFAULT_SETTINGS)
  const locale = resolveLocale(boot, navigator.languages)
  // Só o do idioma ativo: a reserva vem depois do primeiro desenho (ver main.tsx), fora do caminho da tela.
  await loadLocale(locale, false)
  // Se o catálogo do idioma não carregou, espera ao menos o de reserva (inglês), para não desenhar chaves cruas.
  if (!setLocale(locale)) await loadFallbacks()
}

/** Depois do primeiro desenho, com o navegador livre, baixa o catálogo de reserva (inglês). */
export function loadFallbacksLater(): void {
  const later = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn: () => void) => setTimeout(fn, 1000)
  later(() => void loadFallbacks())
}

/**
 * Idioma em uso na tela. Se o pedido já foi carregado, troca na hora (durante o desenho, antes de os
 * componentes escreverem textos); senão mantém o atual, carrega e redesenha quando chegar: "carregar e só então
 * trocar", sem chaves cruas. Pedidos seguidos não se atropelam: o redesenho recalcula o idioma pedido agora.
 */
export function useLocaleCatalog(locale: LocaleId): LocaleId {
  const [, loaded] = useReducer((n: number) => n + 1, 0)
  if (getLocale() !== locale && !setLocale(locale)) void loadLocale(locale).then(loaded)
  return getLocale()
}

/** Passa o formato de datas das configurações ao módulo de textos (chamado a cada desenho, antes de os componentes escreverem datas). */
export function applyDateFormat(settings: Settings, systemLocales: readonly string[]): void {
  setDateFormat(settings.dateFormat, systemLocales[0])
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
  // As letras de status (M, A, D…) somem pelo CSS, em todas as listas de uma vez.
  if (settings.statusLetters) delete root.dataset.statusLetters
  else root.dataset.statusLetters = 'off'
  // Os ícones de arquivo somem pelo CSS (um atributo na raiz), sem redesenhar cada linha da lista.
  if (settings.fileIcons) delete root.dataset.fileIcons
  else root.dataset.fileIcons = 'off'
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
