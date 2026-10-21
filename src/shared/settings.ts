// Configurações gerais do GitTools. Para uma nova opção: acrescente o campo em Settings,
// o valor padrão em DEFAULT_SETTINGS, a validação em normalizeSettings e uma seção
// (ou um campo numa seção existente) em renderer/src/components/settings/sections.tsx.

import { isLocaleId, type LocaleId } from './i18n/locales'

export type ThemeSetting = 'system' | 'dark' | 'light'
export type LanguageSetting = 'system' | LocaleId
/** Como o diff é exibido: linhas antigas e novas uma embaixo da outra, ou lado a lado. */
export type DiffLayout = 'inline' | 'split'

export interface Settings {
  /** Idioma da interface; "system" segue o idioma do sistema operacional. */
  language: LanguageSetting
  theme: ThemeSetting
  /** Escala da interface (1 = 100%). */
  zoom: number
  /** Espessura, em pixels, da linha das divisórias entre painéis (e das alças de colunas). */
  dividerWidth: number
  /** Escala dos botões de recolher/expandir painéis nas divisórias (1 = normal). */
  paneButtonScale: number
  /** Modo em que todo diff abre: cima e baixo ou lado a lado. */
  diffLayout: DiffLayout
  /**
   * Editor usado por "Abrir no editor": id de um editor detectado (ex.: "vscode") ou o caminho de um
   * executável escolhido pelo usuário. Vazio = ainda não escolhido.
   */
  editor: string
  /** Atalhos personalizados: id da ação → combinação (ex.: "Ctrl+Shift+P"). */
  shortcuts: Record<string, string>
}

export const DEFAULT_SETTINGS: Settings = { language: 'system', theme: 'system', zoom: 1, dividerWidth: 2, paneButtonScale: 1.25, diffLayout: 'inline', editor: '', shortcuts: {} }

export const ZOOM_LEVELS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6]
export const DIVIDER_WIDTHS = [1, 2, 3, 4, 6, 8]
export const PANE_BUTTON_SCALES = [1, 1.25, 1.5, 2]

const oneOf = (value: unknown, options: number[], fallback: number) => (typeof value === 'number' && options.includes(value) ? value : fallback)

/** Aceita qualquer valor lido do disco e devolve configurações válidas. */
export function normalizeSettings(value: unknown): Settings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof Settings, unknown>>
  const shortcuts =
    raw.shortcuts && typeof raw.shortcuts === 'object'
      ? Object.fromEntries(Object.entries(raw.shortcuts as Record<string, unknown>).filter(([, v]) => typeof v === 'string'))
      : {}
  return {
    language: raw.language === 'system' || isLocaleId(raw.language) ? raw.language : DEFAULT_SETTINGS.language,
    theme: raw.theme === 'dark' || raw.theme === 'light' || raw.theme === 'system' ? raw.theme : DEFAULT_SETTINGS.theme,
    zoom: typeof raw.zoom === 'number' && raw.zoom >= 0.5 && raw.zoom <= 2 ? raw.zoom : DEFAULT_SETTINGS.zoom,
    dividerWidth: oneOf(raw.dividerWidth, DIVIDER_WIDTHS, DEFAULT_SETTINGS.dividerWidth),
    paneButtonScale: oneOf(raw.paneButtonScale, PANE_BUTTON_SCALES, DEFAULT_SETTINGS.paneButtonScale),
    diffLayout: raw.diffLayout === 'split' ? 'split' : 'inline',
    editor: typeof raw.editor === 'string' ? raw.editor.trim() : DEFAULT_SETTINGS.editor,
    shortcuts: shortcuts as Record<string, string>
  }
}
