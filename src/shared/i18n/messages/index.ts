import type { LocaleId } from '../locales'
import type { Messages } from '../types'
import { ar } from './ar'
import { en } from './en'
import { es } from './es'
import { hi } from './hi'
import { ptBR } from './pt-BR'
import { zhCN } from './zh-CN'

/** Catálogos de tradução de cada idioma (o TypeScript garante que todos têm as mesmas chaves). */
export const CATALOGS: Record<LocaleId, Messages> = {
  'pt-BR': ptBR,
  en,
  es,
  'zh-CN': zhCN,
  hi,
  ar
}
