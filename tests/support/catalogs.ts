// Os aplicativos carregam um catálogo de idioma por vez (sob demanda). Nos testes os seis ficam em memória desde o
// início, para `setLocale` e `translatorFor` funcionarem de forma síncrona em qualquer idioma.
import { LOCALE_IDS, registerCatalog } from '../../src/shared/i18n'
import { CATALOGS } from '../../src/shared/i18n/messages'

for (const id of LOCALE_IDS) registerCatalog(id, CATALOGS[id])
