// Atalho para o módulo de idiomas compartilhado (o mesmo usado pelo processo principal).
import { setCatalogLoader, type LocaleId, type Messages } from '../../shared/i18n'

export * from '../../shared/i18n'

/**
 * Na interface cada catálogo é um pedaço separado do pacote (import()), baixado só quando o idioma é usado.
 * O `Record` obriga a ter um carregador para cada idioma; o tipo de cada catálogo continua conferido no
 * próprio arquivo (`Messages`, derivado do pt-BR).
 */
const IMPORTS: Record<LocaleId, () => Promise<Messages>> = {
  'pt-BR': () => import('../../shared/i18n/messages/pt-BR').then((m) => m.ptBR),
  en: () => import('../../shared/i18n/messages/en').then((m) => m.en),
  es: () => import('../../shared/i18n/messages/es').then((m) => m.es),
  'zh-CN': () => import('../../shared/i18n/messages/zh-CN').then((m) => m.zhCN),
  hi: () => import('../../shared/i18n/messages/hi').then((m) => m.hi),
  ar: () => import('../../shared/i18n/messages/ar').then((m) => m.ar)
}

setCatalogLoader((locale) => IMPORTS[locale]())
