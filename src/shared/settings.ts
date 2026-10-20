// Configurações gerais do GitTools. Para uma nova opção: acrescente o campo em Settings,
// o valor padrão em DEFAULT_SETTINGS, a validação em normalizeSettings e uma seção
// (ou um campo numa seção existente) em renderer/src/components/settings/sections.tsx.

import { isLocaleId, type LocaleId } from './i18n/locales'

export type ThemeSetting = 'system' | 'dark' | 'light'
export type LanguageSetting = 'system' | LocaleId

export interface Settings {
  /** Idioma da interface; "system" segue o idioma do sistema operacional. */
  language: LanguageSetting
  theme: ThemeSetting
  /** Escala da interface (1 = 100%). */
  zoom: number
  /** Atalhos personalizados: id da ação → combinação (ex.: "Ctrl+Shift+P"). */
  shortcuts: Record<string, string>
}

export const DEFAULT_SETTINGS: Settings = { language: 'system', theme: 'system', zoom: 1, shortcuts: {} }

export const ZOOM_LEVELS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6]

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
    shortcuts: shortcuts as Record<string, string>
  }
}
