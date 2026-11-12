// Gate de cobertura de cenários: o check `QA` (workflow .github/workflows/qa.yml) roda isto antes da validação.
//   node scripts/validacao/gate-cobertura.mjs
// Sempre confere as telas do topo (screenVisibility.ts) contra os cenários. Num evento de pull_request, confere
// também o PR (rótulos, corpo e arquivos alterados). Corpo do PR é texto de fora: nunca vai para shell nem para a
// saída. Saída: 0 passou; 1 reprovou; 2 erro de uso ou de leitura.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { avaliarPR, lerIdsDeTelas, lerTelasDosCenarios, TELA_POR_ID, telasSemCenario } from './cobertura.mjs'
import { RAIZ } from './lib.mjs'

// Só sha completo entra no comando git: o valor vem do evento, e a regex impede que vire opção ou outra coisa.
const SHA = /^[0-9a-f]{40}$/
// Teto do texto que o git devolve com a lista de arquivos de um PR (um diff de milhares de arquivos cabe).
const LIMITE_DIFF = 64 * 1024 * 1024

function conferirTelas(telas) {
  const texto = readFileSync(join(RAIZ, 'src/renderer/src/screenVisibility.ts'), 'utf8')
  const ids = lerIdsDeTelas(texto)
  const faltando = telasSemCenario(ids, telas)
  if (faltando.length === 0) {
    console.log(`OK     telas: as ${ids.length} telas do topo têm cenário`)
    return true
  }
  for (const id of faltando) {
    if (!Object.hasOwn(TELA_POR_ID, id)) {
      console.log(`FALHA  tela "${id}": não está em TELA_POR_ID (scripts/validacao/cobertura.mjs)`)
    } else {
      console.log(`FALHA  tela "${id}": nenhum cenário com tela "${TELA_POR_ID[id]}" em scripts/validacao/e2e/cenarios/`)
    }
  }
  return false
}

function lerEvento(caminho) {
  if (!caminho) throw new Error('GITHUB_EVENT_PATH ausente num evento de pull_request')
  const evento = JSON.parse(readFileSync(caminho, 'utf8'))
  const pr = evento?.pull_request
  if (!pr || typeof pr !== 'object') throw new Error('o evento não traz pull_request')
  const base = pr.base?.sha
  const head = pr.head?.sha
  if (typeof base !== 'string' || !SHA.test(base) || typeof head !== 'string' || !SHA.test(head)) {
    throw new Error('sha de base ou de head ausente ou inválido no evento')
  }
  const rotulos = Array.isArray(pr.labels) ? pr.labels.map((l) => l?.name).filter((n) => typeof n === 'string') : []
  // Corpo null é o normal de um PR sem descrição; não é erro.
  const corpo = typeof pr.body === 'string' ? pr.body : null
  return { base, head, rotulos, corpo }
}

function arquivosDoPR(base, head) {
  // execFileSync sem shell. `--no-renames` lista o caminho antigo também, que é o conservador para o gate.
  const saida = execFileSync('git', ['diff', '-z', '--name-only', '--no-renames', `${base}...${head}`], {
    cwd: RAIZ,
    encoding: 'utf8',
    maxBuffer: LIMITE_DIFF,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return saida.split('\0').filter((c) => c !== '')
}

async function main() {
  let ok = conferirTelas(await lerTelasDosCenarios())
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    const { base, head, rotulos, corpo } = lerEvento(process.env.GITHUB_EVENT_PATH)
    const veredito = avaliarPR({ arquivos: arquivosDoPR(base, head), rotulos, corpo })
    console.log(`${veredito.ok ? 'OK     ' : 'FALHA  '}PR: ${veredito.motivo}`)
    ok = ok && veredito.ok
  }
  return ok ? 0 : 1
}

main().then(
  (codigo) => {
    process.exitCode = codigo
  },
  (erro) => {
    console.error(`gate-cobertura: ${erro?.message ?? erro}`)
    process.exitCode = 2
  }
)
