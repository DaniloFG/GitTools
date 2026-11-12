// Pipeline de validação: o mesmo comando na develop e na homolog (workflow .github/workflows/validacao.yml).
// Roda em ordem typecheck, testes, builds, tamanho do pacote e o ponta a ponta na interface de verdade, mede o
// tempo de cada fase e grava o relatório com o commit e a árvore testados.
//
//   node scripts/validacao/pipeline.mjs [--keep-going] [--so <fase>] [--igual-a <ref>]
//
// A saída de cada fase vai para validacao-out/<fase>.log; só o fim aparece aqui quando a fase falha.
// Sai com 0 só se todas as fases passaram (código 2: argumento inválido).
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compararArvores, FASE_IGUAL, fasesDoPlano, formatarRelatorio, montarRelatorio, parseArgs, RAIZ, SAIDA, ultimasLinhas } from './lib.mjs'

const opcoes = parseArgs(process.argv.slice(2))
if (opcoes.erro) {
  console.error(`validar: ${opcoes.erro}`)
  console.error('uso: node scripts/validacao/pipeline.mjs [--keep-going] [--so <fase>] [--igual-a <ref>]')
  process.exit(2)
}

mkdirSync(SAIDA, { recursive: true })

const git = (...args) => execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const logDe = (nome) => join(SAIDA, `${nome}.log`)

/** Roda o comando com a saída inteira no arquivo de log da fase e devolve o código de saída. */
function executar(comando, arquivo) {
  const fd = openSync(arquivo, 'w')
  return new Promise((resolver) => {
    // No Windows `npm` é um .cmd e só abre por shell; os argumentos aqui são fixos, nunca vêm do usuário.
    const filho = spawn(comando[0], comando.slice(1), { cwd: RAIZ, stdio: ['ignore', fd, fd], shell: process.platform === 'win32' })
    filho.on('error', (erro) => {
      writeFileSync(arquivo, `não foi possível iniciar ${comando.join(' ')}: ${erro.message}\n`)
      resolver(127)
    })
    filho.on('close', (codigo) => resolver(codigo ?? 1))
  }).finally(() => closeSync(fd))
}

/** A árvore do HEAD tem de ser idêntica à de `--igual-a`; a mensagem mostra as duas quando diferem. */
function conferirArvore(arquivo) {
  let texto
  let ok = false
  try {
    const { igual, arvoreA, arvoreB } = compararArvores('HEAD', opcoes.igualA, RAIZ)
    ok = igual
    texto = igual
      ? `árvore idêntica a ${opcoes.igualA}: ${arvoreA}\n`
      : `a árvore difere de ${opcoes.igualA}\n  HEAD: ${arvoreA}\n  ${opcoes.igualA}: ${arvoreB}\n`
  } catch (erro) {
    texto = `${erro.message}\n`
  }
  writeFileSync(arquivo, texto)
  return ok ? 0 : 1
}

const resultados = []
for (const fase of fasesDoPlano(opcoes)) {
  const arquivo = logDe(fase.nome)
  console.log(`> ${fase.nome}`)
  const inicio = Date.now()
  const codigo = fase.nome === FASE_IGUAL ? conferirArvore(arquivo) : await executar(fase.comando, arquivo)
  const ms = Date.now() - inicio
  const ok = codigo === 0
  resultados.push({ nome: fase.nome, ok, ms })
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${fase.nome} (${ms} ms)`)
  if (!ok) {
    console.log(`--- fim de ${arquivo} (saída ${codigo}) ---`)
    console.log(ultimasLinhas(readFileSync(arquivo, 'utf8'), 15))
    if (!opcoes.keepGoing) break
  }
}

// Em HEAD destacado (CI de PR, por exemplo) `branch --show-current` vem vazio: usa o nome que o CI informa.
const branch = git('branch', '--show-current') || process.env.GITHUB_REF_NAME || '(HEAD destacado)'
const relatorio = montarRelatorio({ commit: git('rev-parse', 'HEAD'), arvore: git('rev-parse', 'HEAD^{tree}'), branch, quando: new Date().toISOString(), fases: resultados })
writeFileSync(join(SAIDA, 'relatorio.json'), JSON.stringify(relatorio, null, 2) + '\n')
const texto = formatarRelatorio(relatorio)
writeFileSync(join(SAIDA, 'relatorio.txt'), texto)
console.log('\n' + texto)
process.exit(relatorio.ok ? 0 : 1)
