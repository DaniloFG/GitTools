import type { ptBR } from './messages/pt-BR'

/** Formas de plural do Unicode CLDR; `other` é obrigatória. */
export type PluralForms = { other: string } & Partial<Record<'zero' | 'one' | 'two' | 'few' | 'many', string>>

export type MessageValue = string | PluralForms

type Shape<T> = {
  [K in keyof T]: T[K] extends string ? MessageValue : T[K] extends { other: string } ? MessageValue : Shape<T[K]>
}

/** Formato que todo catálogo de idioma precisa seguir (o pt-BR é a referência). */
export type Messages = Shape<typeof ptBR>

type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | { other: string } ? `${P}${K}` : Paths<T[K], `${P}${K}.`>
}[keyof T & string]

/** Todas as chaves válidas, ex.: "history.selected". */
export type MessageKey = Paths<typeof ptBR>

export type MessageParams = Record<string, string | number>
