// Configurações gerais do GitTools. Para uma nova opção: acrescente o campo em Settings,
// o valor padrão em DEFAULT_SETTINGS, a validação em normalizeSettings e uma seção
// (ou um campo numa seção existente) em renderer/src/components/settings/sections.tsx.

import { isLocaleId, type LocaleId } from './i18n/locales'

export type ThemeSetting = 'system' | 'dark' | 'light'
export type LanguageSetting = 'system' | LocaleId
/** Como o diff é exibido: linhas antigas e novas uma embaixo da outra, ou lado a lado. */
export type DiffLayout = 'inline' | 'split'
/** Formato de datas e horas: ISO (2026-12-31 23:59:59), o do sistema, ou o do idioma em 24 h / 12 h. */
export type DateFormatSetting = 'iso' | 'system' | '24h' | '12h'
export const DATE_FORMATS: readonly DateFormatSetting[] = ['iso', 'system', '24h', '12h']

export type ToastHorizontal = 'left' | 'center' | 'right'
export type ToastVertical = 'top' | 'middle' | 'bottom'

/** Onde e com que tamanho aparecem as notificações (toasts) de sucesso, erro e aviso. */
export interface ToastSettings {
  horizontal: ToastHorizontal
  vertical: ToastVertical
  /** Largura de cada notificação, em pixels. */
  width: number
  /** Altura máxima de cada notificação, em pixels (textos maiores rolam). */
  height: number
}

export const TOAST_WIDTH = { min: 240, max: 1200, step: 20 }
export const TOAST_HEIGHT = { min: 60, max: 800, step: 20 }

/** Tamanhos prontos (largura × altura máxima), acima do máximo do controle deslizante inclusive. */
export const TOAST_SIZES = {
  standard: { width: 380, height: 240 },
  large: { width: 560, height: 360 },
  extra: { width: 800, height: 520 },
  wide: { width: 1200, height: 640 }
} as const

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
  /** Posição e tamanho das notificações. */
  toast: ToastSettings
  /** Como datas e horas são escritas nas listas e nos detalhes. */
  dateFormat: DateFormatSetting
  /** Mostra o ícone do tipo de cada arquivo ao lado do nome. */
  fileIcons: boolean
  /** Mostra a letra da modificação (M, A, D, R…) ao lado de cada arquivo. */
  statusLetters: boolean
  /** O diff abre mostrando o arquivo inteiro (true) ou só os trechos alterados (false). */
  diffFullFile: boolean
  /** Assistente de git no editor: balão ao final da linha do cursor dizendo quem a alterou, quando e o que o commit fez. */
  inlineBlame: boolean
  /** Atalhos personalizados: id da ação → combinação (ex.: "Ctrl+Shift+P"). */
  shortcuts: Record<string, string>
}

export const DEFAULT_SETTINGS: Settings = { language: 'system', theme: 'system', zoom: 1, dividerWidth: 2, paneButtonScale: 1.25, diffLayout: 'inline', dateFormat: 'iso', editor: '', fileIcons: true, statusLetters: true, diffFullFile: false, inlineBlame: true, toast: { horizontal: 'right', vertical: 'bottom', width: 380, height: 240 }, shortcuts: {} }

export const ZOOM_LEVELS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6]
export const DIVIDER_WIDTHS = [1, 2, 3, 4, 6, 8]
export const PANE_BUTTON_SCALES = [1, 1.25, 1.5, 2]

const oneOf = (value: unknown, options: number[], fallback: number) => (typeof value === 'number' && options.includes(value) ? value : fallback)

const clampTo = (value: unknown, limits: { min: number; max: number; step: number }, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(limits.max, Math.max(limits.min, Math.round(value / limits.step) * limits.step)) : fallback

function normalizeToast(value: unknown): ToastSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof ToastSettings, unknown>>
  const d = DEFAULT_SETTINGS.toast
  return {
    horizontal: raw.horizontal === 'left' || raw.horizontal === 'center' || raw.horizontal === 'right' ? raw.horizontal : d.horizontal,
    vertical: raw.vertical === 'top' || raw.vertical === 'middle' || raw.vertical === 'bottom' ? raw.vertical : d.vertical,
    width: clampTo(raw.width, TOAST_WIDTH, d.width),
    height: clampTo(raw.height, TOAST_HEIGHT, d.height)
  }
}

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
    dateFormat: DATE_FORMATS.includes(raw.dateFormat as DateFormatSetting) ? (raw.dateFormat as DateFormatSetting) : DEFAULT_SETTINGS.dateFormat,
    fileIcons: raw.fileIcons !== false,
    statusLetters: raw.statusLetters !== false,
    diffFullFile: raw.diffFullFile === true,
    inlineBlame: raw.inlineBlame !== false,
    editor: typeof raw.editor === 'string' ? raw.editor.trim() : DEFAULT_SETTINGS.editor,
    toast: normalizeToast(raw.toast),
    shortcuts: shortcuts as Record<string, string>
  }
}
