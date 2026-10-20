import type { LocaleId } from './locales'
import type { MessageKey, MessageParams, MessageValue, Messages } from './types'

export type Translate = (key: MessageKey, params?: MessageParams) => string

function lookup(catalog: Messages | undefined, key: string): MessageValue | undefined {
  let node: unknown = catalog
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  if (typeof node === 'string') return node
  if (node && typeof node === 'object' && 'other' in node) return node as MessageValue
  return undefined
}

/**
 * Cria a função de tradução de um idioma. Procura a chave no idioma pedido e, se faltar,
 * nos idiomas de reserva. Parâmetros entram no texto como {nome}; `count` escolhe a forma
 * de plural segundo as regras do idioma (Intl.PluralRules).
 */
export function createTranslator(locale: LocaleId, catalogs: Partial<Record<LocaleId, Messages>>, fallbacks: LocaleId[]): Translate {
  const chain = [locale, ...fallbacks.filter((f) => f !== locale)].map((id) => catalogs[id])
  const plural = new Intl.PluralRules(locale)
  const number = new Intl.NumberFormat(locale)

  return (key, params) => {
    let value: MessageValue | undefined
    for (const catalog of chain) {
      value = lookup(catalog, key)
      if (value !== undefined) break
    }
    if (value === undefined) return key
    let text: string
    if (typeof value === 'string') text = value
    else {
      const count = Number(params?.count ?? 0)
      // `zero`, quando existe, vale para o número 0 em qualquer idioma (ex.: "Stage linhas").
      text = (count === 0 ? value.zero : undefined) ?? value[plural.select(count)] ?? value.other
    }
    if (!params) return text
    return text.replace(/\{(\w+)\}/g, (match, name: string) => {
      const param = params[name]
      if (param === undefined) return match
      return typeof param === 'number' ? number.format(param) : param
    })
  }
}
