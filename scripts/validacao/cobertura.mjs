// Gate de cobertura de cenários (check obrigatório `QA`, workflow qa.yml). Lógica pura, para o teste
// (tests/gate-cobertura.test.ts) cobrir sem subir git nem Chromium. A CLI que junta os dados do PR está em
// gate-cobertura.mjs; o único I/O deste módulo é o de lerTelasDosCenarios, que lê a pasta de cenários.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Tela do topo (id de TOP_SCREEN_IDS, em screenVisibility.ts) → valor do campo `tela` dos cenários. Quando uma tela
 * nova entra na lista e este mapa não a conhece, ela conta como sem cenário: a lacuna aparece em vez de passar.
 */
export const TELA_POR_ID = Object.freeze({
  history: 'History',
  changes: 'Changes',
  files: 'Files',
  compare: 'Compare',
  branches: 'Branches',
  gitlog: 'Git log',
  dashboards: 'Dashboard'
})

const PASTA_CENARIOS = fileURLToPath(new URL('./e2e/cenarios/', import.meta.url))
const PREFIXO_COMPONENTES = 'src/renderer/src/components/'
const PREFIXO_CENARIOS = 'scripts/validacao/e2e/cenarios/'
const ROTULO_SEM_E2E = 'sem-e2e'
// Uma linha só (`[ \t]`, não `\s`, que atravessaria quebras de linha). O corpo do PR é texto de fora: a regex não
// tem repetição aninhada, então um corpo grande não pesa além do linear.
const JUSTIFICATIVA = /^sem-e2e:[ \t]*(\S.{9,})$/m

/**
 * Ids das telas do topo, lidos do texto de screenVisibility.ts. A lista é a fonte única: ler dela (e não de um
 * segundo cadastro) faz uma tela nova aparecer aqui. Lança se o array não estiver lá: gate que lê lista vazia
 * passaria em silêncio.
 * @param {string} texto
 * @returns {string[]}
 */
export function lerIdsDeTelas(texto) {
  // `export const` ancora na declaração: uma menção no comentário ou no uso do array não confunde a leitura.
  const bloco = /export const TOP_SCREEN_IDS\b[^=]*=\s*\[([^\]]*)\]/.exec(String(texto))
  if (!bloco) throw new Error('TOP_SCREEN_IDS não encontrado em screenVisibility.ts')
  const ids = [...bloco[1].matchAll(/['"]([A-Za-z_]+)['"]/g)].map((m) => m[1])
  if (ids.length === 0) throw new Error('TOP_SCREEN_IDS sem nenhum id')
  return ids
}

/**
 * Ids sem cenário. `telasDosCenarios` são os valores de `tela` dos cenários. Id fora de TELA_POR_ID também conta
 * como sem cenário: mapa desatualizado reprova.
 * @param {readonly string[]} ids
 * @param {Iterable<string>} telasDosCenarios
 * @returns {string[]}
 */
export function telasSemCenario(ids, telasDosCenarios) {
  const telas = new Set(telasDosCenarios)
  // hasOwn: um id 'constructor' não pode achar o protótipo de Object e passar por mapeado.
  return ids.filter((id) => !Object.hasOwn(TELA_POR_ID, id) || !telas.has(TELA_POR_ID[id]))
}

/**
 * Confere o PR. Mudança em components (a interface) exige cenário de ponta a ponta no mesmo PR; a exceção é o
 * rótulo `sem-e2e` com a justificativa no corpo. Justificativa sem o rótulo não basta: o rótulo é a decisão visível
 * na lista do PR, e o texto livre do corpo não decide sozinho.
 * @param {{ arquivos: readonly string[], rotulos: readonly string[], corpo: string | null }} pr
 * @returns {{ ok: boolean, motivo: string }}
 */
export function avaliarPR({ arquivos, rotulos, corpo }) {
  const caminhos = (Array.isArray(arquivos) ? arquivos : []).map((c) => String(c).replace(/\\/g, '/'))
  if (!caminhos.some((c) => c.startsWith(PREFIXO_COMPONENTES))) {
    return { ok: true, motivo: 'nenhuma mudança em components' }
  }
  if (caminhos.some((c) => c.startsWith(PREFIXO_CENARIOS))) {
    return { ok: true, motivo: 'mudança em components acompanhada de cenário de ponta a ponta' }
  }
  const comRotulo = Array.isArray(rotulos) && rotulos.includes(ROTULO_SEM_E2E)
  if (!comRotulo) {
    return { ok: false, motivo: 'mudança em components sem cenário de ponta a ponta em scripts/validacao/e2e/cenarios/' }
  }
  if (JUSTIFICATIVA.test(typeof corpo === 'string' ? corpo : '')) {
    return { ok: true, motivo: 'mudança em components sem cenário, com sem-e2e justificado no corpo' }
  }
  return { ok: false, motivo: 'rótulo sem-e2e sem justificativa: escreva no corpo uma linha "sem-e2e: <motivo com pelo menos 10 caracteres>"' }
}

/**
 * Valores de `tela` dos cenários da pasta. Único I/O deste módulo: lê a lista de arquivos e importa cada .mjs
 * (os cenários não rodam nada ao ser importados). Arquivo sem `tela` textual não entra no conjunto.
 * @param {string} [pasta]
 * @returns {Promise<Set<string>>}
 */
export async function lerTelasDosCenarios(pasta = PASTA_CENARIOS) {
  const telas = new Set()
  for (const arquivo of readdirSync(pasta).filter((n) => n.endsWith('.mjs')).sort()) {
    const modulo = await import(pathToFileURL(join(pasta, arquivo)).href)
    const tela = modulo.default?.tela
    if (typeof tela === 'string') telas.add(tela)
  }
  return telas
}
