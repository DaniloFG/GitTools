// #96 (E8): trocar de arquivo no meio da resolução não perde as escolhas por trecho (conflictDrafts.ts). Dois arquivos em
// conflito, dois trechos cada. Em A escolhe-se só o primeiro trecho; troca-se para B e volta para A: a escolha continua
// (o resumo do rodapé e o bloco marcado são os mesmos), sem nada gravado no disco e com a troca gastando só os processos
// do conflictDetails (três `git show :n:`, um por estágio). Salvar A completo grava o resultado e apaga o rascunho: se
// o conflito de A voltar com o mesmo texto, o editor abre sem nenhuma escolha.
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const A = 'lote/a.txt'
const B = 'lote/b.txt'
const ARQUIVOS = [A, B]
/** Teto da troca de arquivo: o conflictDetails (src/core/repository.ts) abre três processos, `git show :1:`, `:2:` e `:3:`. */
const PROCESSOS_TROCA = 3
/** Linhas iguais entre os dois trechos: sem elas o git juntaria os dois conflitos num só. */
const LINHAS_MEIO = 7

export default {
  id: 'conflito-escolhas-preservadas',
  tela: 'Conflitos',
  area: 'conflitos',
  orcamento: { ms: 20000, nos: 5000, erros: 0, git: 0 },
  // Salvar o arquivo faz `git add` (escrita): o cenário é de quem altera o repositório. A troca de arquivo é conferida à parte.
  escreve: true,
  async passos(app, expect) {
    const { dir } = await app.repoNovo({
      wip: false,
      nome: 'escolhas-e2e',
      // Mesmo preparo de conflito-resolver-muitos, com dois arquivos: cada um sai com dois trechos em conflito.
      async preparar({ dir: repo }) {
        await mkdir(join(repo, 'lote'), { recursive: true })
        const escrever = (versao) => Promise.all(ARQUIVOS.map((a) => writeFile(join(repo, a), conteudo(versao, a))))
        await escrever('base')
        await app.git('add', '-A')
        await app.git('commit', '-q', '-m', 'lote: base')
        await app.git('checkout', '-q', '-b', 'lote-deles')
        await escrever('deles')
        await app.git('add', '-A')
        await app.git('commit', '-q', '-m', 'lote: deles')
        const deles = (await app.git('rev-parse', 'HEAD')).trim()
        await app.git('checkout', '-q', 'main')
        await escrever('nosso')
        await app.git('add', '-A')
        await app.git('commit', '-q', '-m', 'lote: nosso')
        await app.git('cherry-pick', deles).then(
          () => { throw new Error('o cherry-pick deveria parar em conflito') },
          (erro) => { if (erro.code !== 1) throw erro }
        )
      }
    })

    // Estado do disco e do índice antes de qualquer ação: a troca de arquivo não pode mudar nenhum dos dois.
    const discoAntes = await lerDisco(dir)
    const indiceAntes = (await app.git('ls-files', '--unmerged')).trim()
    expect.verdadeiro(discoAntes[0].includes('<<<<<<<'), 'o arquivo A deveria estar com marcadores de conflito na partida')

    await app.page.locator('button.operation-title').click()
    await app.page.locator('.conflicts-screen').waitFor()
    await expect.pagina(() => document.querySelector('.conflicts-counts')?.textContent === 'Pending: 2 of 2', null, 'contador da tela com 2 pendentes')

    await abrir(app, expect, A)
    const resumoInicial = await resumo(app)
    await expect.pagina(([n, kind]) => document.querySelector(`.conflict-editor .merge-block[data-conflict="${n}"]`)?.dataset.kind === kind, [0, 'conflict'], 'primeiro trecho de A pendente')

    // Escolhe só o primeiro trecho de A: "Use current" da faixa do próprio bloco, no painel da versão atual.
    await usarAtual(app, 0)
    await expect.pagina(([n, kind]) => document.querySelector(`.conflict-editor .merge-block[data-conflict="${n}"]`)?.dataset.kind === kind, [0, 'resolved'], 'primeiro trecho de A resolvido')
    await expect.pagina(() => document.querySelector(`.conflict-editor .merge-block[data-conflict="1"]`)?.dataset.kind === 'conflict', null, 'segundo trecho de A continua pendente')
    const resumoEscolha = await resumo(app)
    expect.verdadeiro(resumoEscolha !== resumoInicial, `o resumo do rodapé deveria mudar com a escolha (ficou "${resumoEscolha}")`)

    // Troca para B: conta só os processos da troca (o editor de B lê o conflito dele, nada mais).
    const antes = await ids(app)
    await abrir(app, expect, B)
    const novos = (await app.backend.invoke('app:gitLog', [])).filter((e) => !antes.has(e.id))
    expect.verdadeiro(novos.length <= PROCESSOS_TROCA, `trocar de arquivo abriu ${novos.length} processos git (teto ${PROCESSOS_TROCA})`)
    expect.verdadeiro(novos.every((e) => e.args.includes('show')), `trocar de arquivo rodou comando que não é leitura de estágio: ${novos.map((e) => e.args.join(' ')).join(' | ')}`)
    expect.igual(await lerDisco(dir), discoAntes, 'disco inalterado depois da troca de arquivo')
    expect.igual((await app.git('ls-files', '--unmerged')).trim(), indiceAntes, 'índice inalterado depois da troca de arquivo')

    // Volta para A: a escolha continua, com o mesmo resumo e o mesmo bloco marcado.
    await abrir(app, expect, A)
    await expect.pagina(([n, kind]) => document.querySelector(`.conflict-editor .merge-block[data-conflict="${n}"]`)?.dataset.kind === kind, [0, 'resolved'], 'escolha do primeiro trecho de A preservada')
    expect.igual(await resumo(app), resumoEscolha, 'resumo do rodapé igual ao de antes da troca')
    const ativo = await app.page.evaluate(() => !!document.querySelector('.conflict-editor .merge-block[data-conflict="0"] .merge-block-bar button[title="Use current"].active'))
    expect.verdadeiro(ativo, 'o botão "Use current" do primeiro trecho deveria estar marcado depois de voltar a A')

    // Salva A completo (os dois trechos com a versão atual): grava o resultado e apaga o rascunho.
    await usarAtual(app, 1)
    await expect.pagina(([n, kind]) => document.querySelector(`.conflict-editor .merge-block[data-conflict="${n}"]`)?.dataset.kind === kind, [1, 'resolved'], 'segundo trecho de A resolvido')
    await app.page.locator('.conflict-editor-foot button.primary').click()
    await expect.pagina((c) => !document.querySelector(`.conflicts-row[title="${c}"]`), A, 'A saiu da lista depois de salvar')
    await expect.pagina(() => document.querySelector('.conflicts-counts')?.textContent === 'Pending: 1 of 1', null, 'contador da tela com 1 pendente')
    const depois = await lerDisco(dir)
    expect.igual(depois[0], await app.git('show', `HEAD:${A}`), 'A salvo igual à versão atual (todos os trechos com "Use current")')
    expect.igual(depois[1], discoAntes[1], 'B continua igual ao de partida no disco')

    // Reabrir A com o mesmo texto de conflito: o rascunho apagado ao salvar não pode voltar. O conflito é recriado
    // com os mesmos estágios e o mesmo texto de partida (ferramenta de preparo, fora do backend).
    const blob = async (ref) => (await app.git('rev-parse', `${ref}:${A}`)).trim()
    const [base, ours, theirs] = [await blob('HEAD~1'), await blob('HEAD'), await blob('lote-deles')]
    await app.git('update-index', '--force-remove', '--', A)
    await gitComEntrada(dir, ['update-index', '--index-info'], `100644 ${base} 1\t${A}\n100644 ${ours} 2\t${A}\n100644 ${theirs} 3\t${A}\n`)
    await writeFile(join(dir, A), discoAntes[0])
    // Volta à janela (o aviso de foco, sem repositório: o mesmo que o `qa.mjs` usa). O aviso do watcher não serve aqui:
    // a alteração foi menos de 1 s depois do salvar da interface (OWN_CHANGE_WINDOW_MS), então `isOwnEcho` o toma como
    // eco e a lista não lê de novo. Mudança de fora logo após uma operação própria só aparece no foco: ver o relatório.
    await app.page.evaluate(() => window.__emit('repo:changed'))
    await expect.pagina((c) => !!document.querySelector(`.conflicts-row[title="${c}"]`), A, 'A voltou à lista com o conflito recriado')
    await abrir(app, expect, A)
    await expect.pagina(() => !document.querySelector('.conflict-editor .merge-block[data-kind="resolved"]'), null, 'nenhum trecho marcado ao reabrir A')
    expect.igual(await resumo(app), resumoInicial, 'resumo ao reabrir A igual ao da primeira abertura')
  }
}

/** Conteúdo de um arquivo: a primeira e a última linha mudam nos dois lados; as do meio ficam iguais. */
function conteudo(versao, nome) {
  const meio = Array.from({ length: LINHAS_MEIO }, (_, n) => `${nome} meio ${n}`)
  return [`${versao} topo ${nome}`, ...meio, `${versao} fundo ${nome}`].join('\n') + '\n'
}

async function lerDisco(dir) {
  return Promise.all(ARQUIVOS.map((a) => readFile(join(dir, a), 'utf8')))
}

/** Lê o texto do rodapé: o resumo do progresso ("n de m" na língua da interface). */
function resumo(app) {
  return app.page.locator('.conflict-editor-foot .footer-summary').textContent()
}

/** Conjunto dos ids já no log do backend: a diferença entre dois conjuntos são os processos de um intervalo. */
async function ids(app) {
  return new Set((await app.backend.invoke('app:gitLog', [])).map((e) => e.id))
}

/** Abre o arquivo pela lista e espera o editor dele carregado (o título vem antes; o painel só depois dos detalhes). */
async function abrir(app, expect, arquivo) {
  await app.page.locator(`.conflicts-row[title="${arquivo}"]`).click()
  await expect.pagina((c) => document.querySelector('.conflict-editor-title')?.getAttribute('title')?.includes(c), arquivo, `editor de ${arquivo} aberto`)
  await app.page.locator('.conflict-editor .merge-editor').waitFor()
}

/** "Use current" da faixa do bloco `n` no painel da versão atual (o título exato separa do botão do painel do resultado). */
function usarAtual(app, n) {
  return app.page.locator(`.conflict-editor .merge-block[data-conflict="${n}"] .merge-block-bar button[title="Use current"]`).first().click()
}

/** Roda o git com um texto na entrada padrão (o `app.git` não envia entrada). Só para o preparo do conflito recriado. */
function gitComEntrada(cwd, args, entrada) {
  return new Promise((resolver, rejeitar) => {
    const filho = execFile('git', args, { cwd, encoding: 'utf8' }, (erro) => (erro ? rejeitar(erro) : resolver()))
    filho.stdin.end(entrada)
  })
}
