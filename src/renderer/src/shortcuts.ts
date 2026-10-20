// Atalhos de teclado: ações com combinação padrão, que o usuário pode trocar nas configurações.

import type { MessageKey } from '../../shared/i18n'

export type ShortcutGroup = 'navigation' | 'git' | 'app'

export interface ShortcutAction {
  id: string
  group: ShortcutGroup
  defaultKeys: string
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: 'view.history', group: 'navigation', defaultKeys: 'Ctrl+1' },
  { id: 'view.changes', group: 'navigation', defaultKeys: 'Ctrl+2' },
  { id: 'view.files', group: 'navigation', defaultKeys: 'Ctrl+3' },
  { id: 'view.compare', group: 'navigation', defaultKeys: 'Ctrl+4' },
  { id: 'studio', group: 'git', defaultKeys: 'Ctrl+Shift+P' },
  { id: 'branch.new', group: 'git', defaultKeys: 'Ctrl+Shift+N' },
  { id: 'stash', group: 'git', defaultKeys: 'Ctrl+Shift+S' },
  { id: 'fetch', group: 'git', defaultKeys: 'Ctrl+Shift+F' },
  { id: 'pull', group: 'git', defaultKeys: 'Ctrl+Shift+L' },
  { id: 'push', group: 'git', defaultKeys: 'Ctrl+Shift+K' },
  { id: 'refresh', group: 'app', defaultKeys: 'F5' },
  { id: 'repo.open', group: 'app', defaultKeys: 'Ctrl+O' },
  { id: 'settings', group: 'app', defaultKeys: 'Ctrl+,' },
  { id: 'help', group: 'app', defaultKeys: 'F1' }
]

/** Nome traduzível de cada ação (as chaves ficam em `shortcuts.actions`). */
export const SHORTCUT_LABELS: Record<string, MessageKey> = {
  'view.history': 'shortcuts.actions.viewHistory',
  'view.changes': 'shortcuts.actions.viewChanges',
  'view.files': 'shortcuts.actions.viewFiles',
  'view.compare': 'shortcuts.actions.viewCompare',
  studio: 'shortcuts.actions.studio',
  'branch.new': 'shortcuts.actions.newBranch',
  stash: 'shortcuts.actions.stash',
  fetch: 'shortcuts.actions.fetch',
  pull: 'shortcuts.actions.pull',
  push: 'shortcuts.actions.push',
  refresh: 'shortcuts.actions.refresh',
  'repo.open': 'shortcuts.actions.openRepository',
  settings: 'shortcuts.actions.settings',
  help: 'shortcuts.actions.help'
}

export const SHORTCUT_GROUP_LABELS: Record<ShortcutGroup, MessageKey> = {
  navigation: 'shortcuts.groups.navigation',
  git: 'shortcuts.groups.git',
  app: 'shortcuts.groups.app'
}

/** Atalhos fixos (dentro de listas e diálogos), exibidos na ajuda. */
export const FIXED_SHORTCUTS: [string, MessageKey][] = [
  ['↑ / ↓', 'shortcuts.fixed.moveSelection'],
  ['Shift+↑ / Shift+↓', 'shortcuts.fixed.extendSelection'],
  ['Ctrl+click / Shift+click', 'shortcuts.fixed.multiSelect'],
  ['Shift+click', 'shortcuts.fixed.lineRange'],
  ['Ctrl+Enter', 'shortcuts.fixed.commit'],
  ['Esc', 'shortcuts.fixed.close']
]

const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

/** Campos de um KeyboardEvent usados para montar a combinação. */
export interface KeyInput {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** Converte um evento de teclado no formato "Ctrl+Shift+P". Retorna null para teclas modificadoras sozinhas. */
export function comboFromEvent(e: KeyInput): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  let key: string
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5)
  else if (e.key === ' ') key = 'Space'
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

/** Texto para exibir uma combinação (no macOS, Ctrl vira ⌘). */
export function displayCombo(combo: string): string {
  return IS_MAC ? combo.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧') : combo
}

export function resolveBindings(overrides: Record<string, string>): Record<string, string> {
  return Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, overrides[a.id] ?? a.defaultKeys]))
}

/** Teclas que funcionam mesmo com o foco num campo de texto. */
export function worksInInputs(combo: string): boolean {
  return /(^|\+)(Ctrl|Alt)\+/.test(combo) || /^F\d+$/.test(combo)
}
