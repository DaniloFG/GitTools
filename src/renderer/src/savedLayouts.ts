// Layouts que o usuário salvou para reutilizar depois (sem React nem DOM, para poder ser testado à parte).
//
// Cada layout guarda uma foto do arranjo dos painéis e dos tamanhos (ver `snapshotLayout`). A lista fica nas
// preferências: o botão de restaurar o layout padrão não a apaga.

import { applyLayoutSnapshot, snapshotLayout, useLayout } from './layout'

export interface SavedLayout {
  id: string
  name: string
  /** Quando foi salvo (ms). */
  savedAt: number
  /** Foto do layout: chave do layout → valor guardado. */
  data: Record<string, unknown>
}

/** No máximo isto de layouts salvos (cada um é uma foto do arranjo inteiro). */
export const MAX_SAVED_LAYOUTS = 30
const NAME_MAX = 60

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Lista salva válida; o que estiver estragado é descartado. */
export function parseSavedLayouts(value: unknown): SavedLayout[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: SavedLayout[] = []
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string' || !isRecord(raw.data)) continue
    const name = cleanName(raw.name)
    if (!raw.id || !name || seen.has(raw.id)) continue
    seen.add(raw.id)
    out.push({ id: raw.id, name, savedAt: typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : 0, data: raw.data })
  }
  return out.slice(0, MAX_SAVED_LAYOUTS)
}

export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)
}

const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase()

/** Já existe um layout com este nome? (Salvar com o mesmo nome substitui o antigo.) */
export function findByName(list: SavedLayout[], name: string): SavedLayout | undefined {
  const clean = cleanName(name)
  return list.find((l) => sameName(l.name, clean))
}

/** Guarda um layout; com um nome que já existe, substitui o conteúdo e mantém o lugar na lista. */
export function addSavedLayout(list: SavedLayout[], name: string, data: Record<string, unknown>, now: number): SavedLayout[] {
  const clean = cleanName(name)
  if (!clean) return list
  const existing = findByName(list, clean)
  if (existing) return list.map((l) => (l === existing ? { ...l, name: clean, savedAt: now, data } : l))
  let n = list.length + 1
  while (list.some((l) => l.id === `l${n}`)) n++
  return [...list, { id: `l${n}`, name: clean, savedAt: now, data }].slice(-MAX_SAVED_LAYOUTS)
}

export function removeSavedLayout(list: SavedLayout[], id: string): SavedLayout[] {
  return list.filter((l) => l.id !== id)
}

/** Troca o nome; recusa nomes vazios e nomes de outro layout. */
export function renameSavedLayout(list: SavedLayout[], id: string, name: string): SavedLayout[] {
  const clean = cleanName(name)
  const clash = list.find((l) => l.id !== id && sameName(l.name, clean))
  if (!clean || clash) return list
  return list.map((l) => (l.id === id ? { ...l, name: clean } : l))
}

const KEY = 'pref.savedLayouts'

/** Layouts salvos e como trocá-los. */
export function useSavedLayouts() {
  return useLayout<SavedLayout[]>(KEY, parseSavedLayouts)
}

/** Salva o layout de agora com um nome. */
export function saveCurrentLayout(list: SavedLayout[], setList: (next: SavedLayout[]) => void, name: string) {
  setList(addSavedLayout(list, name, snapshotLayout(), Date.now()))
}

/** Aplica um layout salvo. */
export function applySavedLayout(layout: SavedLayout) {
  applyLayoutSnapshot(layout.data)
}
