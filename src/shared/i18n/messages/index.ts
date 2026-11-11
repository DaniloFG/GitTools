import type { LocaleId } from '../locales'
import type { Messages } from '../types'
import { ar } from './ar'
import { en } from './en'
import { es } from './es'
import { hi } from './hi'
import { ptBR } from './pt-BR'
import { zhCN } from './zh-CN'

/**
 * Os seis catálogos juntos (o TypeScript garante que todos têm as mesmas chaves).
 * Só para os testes e para o build, que gera um JSON por idioma: o código dos aplicativos NÃO importa este
 * arquivo (traria os seis idiomas para o pacote); ele carrega um idioma de cada vez (ver `../index.ts`).
 */
export const CATALOGS: Record<LocaleId, Messages> = {
  'pt-BR': ptBR,
  en,
  es,
  'zh-CN': zhCN,
  hi,
  ar
}
