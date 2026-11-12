// Textos do passeio (issue #98). Ficam fora do catálogo comum: cada idioma é um pedaço do pacote (import()),
// baixado só quando o Tour precisa dele (a folga da primeira carga é pequena).
// A reserva é o inglês. Sem React: quem desenha chama `loadTourTexts` e depois `tourT`.

import { DEFAULT_LOCALE, getLocale, type LocaleId } from '../../shared/i18n'
import type { TourMessages } from '../../shared/i18n/messages/tour/types'
import { isTourStepId, type TourStepId } from './tour'

/** Textos do cartão (o título e os rótulos fixos); os passos têm uma chave `step.<id>` cada. */
export const TOUR_CARD_KEYS = ['previous', 'next', 'exit', 'finish', 'progress', 'skippedTitle', 'noRepoEnd', 'hiddenTitle', 'title'] as const
export type TourCardKey = (typeof TOUR_CARD_KEYS)[number]
export type TourTextKey = `step.${TourStepId}` | `card.${TourCardKey}`

const CARD_KEY_SET = new Set<string>(TOUR_CARD_KEYS)

function isCardKey(value: string): value is TourCardKey {
  return CARD_KEY_SET.has(value)
}

const IMPORTS: Record<LocaleId, () => Promise<TourMessages>> = {
  'pt-BR': () => import('../../shared/i18n/messages/tour/pt-BR').then((m) => m.tourPtBR),
  en: () => import('../../shared/i18n/messages/tour/en').then((m) => m.tourEn),
  es: () => import('../../shared/i18n/messages/tour/es').then((m) => m.tourEs),
  'zh-CN': () => import('../../shared/i18n/messages/tour/zh-CN').then((m) => m.tourZhCN),
  hi: () => import('../../shared/i18n/messages/tour/hi').then((m) => m.tourHi),
  ar: () => import('../../shared/i18n/messages/tour/ar').then((m) => m.tourAr)
}

const loaded: Partial<Record<LocaleId, TourMessages>> = {}
/** Carregamentos em andamento ou concluídos: pedir o mesmo idioma de novo não baixa outra vez. */
const pending = new Map<LocaleId, Promise<void>>()

function loadOne(locale: LocaleId): Promise<void> {
  let current = pending.get(locale)
  if (!current) {
    current = IMPORTS[locale]()
      .then((messages) => {
        loaded[locale] = messages
      })
      .catch((error: unknown) => {
        // Falha de rede ao baixar o pedaço: sai do cache para a próxima chamada tentar de novo.
        pending.delete(locale)
        throw error
      })
    pending.set(locale, current)
  }
  return current
}

/** Carrega os textos do idioma e o de reserva (inglês). Sem texto carregado, `tourT` devolve a própria chave. */
export function loadTourTexts(locale: LocaleId): Promise<void> {
  return Promise.all([loadOne(locale), loadOne(DEFAULT_LOCALE)]).then(() => undefined)
}

/** Registra os textos de um idioma já em memória (testes; o mesmo papel de `registerCatalog`). */
export function registerTourTexts(locale: LocaleId, messages: TourMessages): void {
  loaded[locale] = messages
  pending.set(locale, Promise.resolve())
}

function textOf(locale: LocaleId, key: TourTextKey): string | undefined {
  const messages = loaded[locale]
  if (!messages) return undefined
  if (key.startsWith('step.')) {
    const id = key.slice('step.'.length)
    return isTourStepId(id) ? messages.step[id] : undefined
  }
  const field = key.slice('card.'.length)
  return isCardKey(field) ? messages.card[field] : undefined
}

/** Troca `{nome}` pelo valor de `params`; o que não tem valor fica como está. */
function fill(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole))
}

/** Texto do passeio no idioma atual; cai no inglês e, sem ele, na própria chave. */
export function tourT(key: TourTextKey, params?: Record<string, string | number>): string {
  const text = textOf(getLocale(), key) ?? textOf(DEFAULT_LOCALE, key) ?? key
  return params ? fill(text, params) : text
}
