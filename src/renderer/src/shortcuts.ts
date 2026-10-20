// Atalhos de teclado: ações com combinação padrão, que o usuário pode trocar nas configurações.

export interface ShortcutAction {
  id: string
  label: string
  group: string
  defaultKeys: string
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: 'view.history', label: 'Ir para Histórico', group: 'Navegação', defaultKeys: 'Ctrl+1' },
  { id: 'view.changes', label: 'Ir para Alterações', group: 'Navegação', defaultKeys: 'Ctrl+2' },
  { id: 'view.files', label: 'Ir para Arquivos (blame e histórico)', group: 'Navegação', defaultKeys: 'Ctrl+3' },
  { id: 'view.compare', label: 'Ir para Comparar', group: 'Navegação', defaultKeys: 'Ctrl+4' },
  { id: 'studio', label: 'Abrir Cherry-pick Studio', group: 'Git', defaultKeys: 'Ctrl+Shift+P' },
  { id: 'branch.new', label: 'Nova branch', group: 'Git', defaultKeys: 'Ctrl+Shift+N' },
  { id: 'stash', label: 'Guardar alterações (stash)', group: 'Git', defaultKeys: 'Ctrl+Shift+S' },
  { id: 'fetch', label: 'Fetch', group: 'Git', defaultKeys: 'Ctrl+Shift+F' },
  { id: 'pull', label: 'Pull', group: 'Git', defaultKeys: 'Ctrl+Shift+L' },
  { id: 'push', label: 'Push', group: 'Git', defaultKeys: 'Ctrl+Shift+K' },
  { id: 'refresh', label: 'Atualizar', group: 'Aplicativo', defaultKeys: 'F5' },
  { id: 'repo.open', label: 'Abrir repositório', group: 'Aplicativo', defaultKeys: 'Ctrl+O' },
  { id: 'settings', label: 'Configurações', group: 'Aplicativo', defaultKeys: 'Ctrl+,' },
  { id: 'help', label: 'Lista de atalhos', group: 'Aplicativo', defaultKeys: 'F1' }
]

/** Atalhos fixos (dentro de listas e diálogos), exibidos na ajuda. */
export const FIXED_SHORTCUTS: [string, string][] = [
  ['↑ / ↓', 'Mover a seleção no histórico'],
  ['Shift+↑ / Shift+↓', 'Estender a seleção de commits'],
  ['Ctrl+clique / Shift+clique', 'Selecionar vários commits ou arquivos'],
  ['Shift+clique numa linha do diff', 'Selecionar um intervalo de linhas'],
  ['Ctrl+Enter', 'Confirmar o commit'],
  ['Esc', 'Fechar diálogo ou menu']
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
