// #92: com muitos arquivos em conflito (200), resolver o do meio da lista com "Use current" no cabeçalho do editor.
// Só esse arquivo sai da lista: o git confirma (ls-files --unmerged tem os outros 199 e nenhum a mais) e o contador da
// tela cai para 199 de 199. A lista é por janela, então a linha do meio é alcançada rolando a lista até ela. Resolver
// e atualizar gasta no máximo 5 processos git, mesmo com 200 arquivos no repositório.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ARQUIVOS = 200
/** Altura fixa de uma linha da lista (ROW em ConflictsScreen.tsx): a posição da linha do meio sai daqui. */
const ALTURA_LINHA = 30

export default {
  id: 'conflito-resolver-muitos',
  tela: 'Conflitos',
  area: 'conflitos',
  // Mais arquivos, mais trabalho na partida (200 linhas, um bloco cada): o teto de tempo é maior que o dos casos de um arquivo.
  orcamento: { ms: 30000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    const { dir } = await app.repoNovo({
      wip: false,
      nome: 'muitos-e2e',
      // `dir` vem aqui pelo argumento: a constante de fora ainda não existe quando o preparo roda.
      async preparar({ dir: repo }) {
        // Base com os 200 arquivos, um commit que muda todos num lado, e a main muda todos de outro jeito: o cherry-pick
        // do commit do lado deles cai em conflito nos 200 arquivos. O que é feito aqui fora do backend não entra na conta.
        await mkdir(join(repo, 'lote'), { recursive: true })
        const escrever = (versao) => Promise.all(Array.from({ length: ARQUIVOS }, (_, n) => writeFile(join(repo, nomeDe(n)), `${versao} ${n}\n`)))
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
    const caminhosDoIndice = (saida) => [...new Set(saida.split('\n').filter(Boolean).map((linha) => linha.split('\t')[1]))]
    const emConflito = caminhosDoIndice(await app.git('ls-files', '--unmerged'))
    expect.igual(emConflito.length, ARQUIVOS, 'arquivos em conflito no índice na partida')

    // O arquivo do meio da lista (ordem do git, a mesma da tela): posição 100 de 200.
    const indice = Math.floor(ARQUIVOS / 2)
    const meio = emConflito[indice]

    await app.page.locator('button.operation-title').click()
    await app.page.locator('.conflicts-screen').waitFor()
    await expect.pagina(() => document.querySelector('.conflicts-counts')?.textContent === 'Pending: 200 of 200', null, 'contador da tela com 200 pendentes')
    // Rola a lista até a linha do meio: só a faixa perto da área visível fica no DOM.
    await app.page.locator('.conflicts-list').evaluate((el, alvo) => { el.scrollTop = alvo }, indice * ALTURA_LINHA)
    await expect.pagina((caminho) => !!document.querySelector(`.conflicts-row[title="${caminho}"]`), meio, 'linha do meio na janela da lista')
    await app.page.locator(`.conflicts-row[title="${meio}"]`).click()
    await app.page.locator('.conflict-editor .merge-editor').waitFor()

    // Conta só os processos da resolução: o que o editor já leu até aqui fica de fora.
    const ids = async () => new Set((await app.backend.invoke('app:gitLog', [])).map((e) => e.id))
    const antes = await ids()
    // Seletor do cabeçalho do editor (grupo de ações do arquivo), não a barra de "Resolve all" com a mesma palavra.
    await app.page.locator('.conflict-file-actions button', { hasText: /^Use current$/ }).click()
    await expect.pagina((caminho) => !document.querySelector('.conflict-editor') && !document.querySelector(`.conflicts-row[title="${caminho}"]`), meio, 'editor fechado e arquivo saiu da lista')
    await expect.pagina(() => document.querySelector('.conflicts-counts')?.textContent === 'Pending: 199 of 199', null, 'contador da tela com 199 pendentes')
    // Espera o git da resolução + atualização assentar: duas leituras iguais do log, todos os processos terminados.
    let ultimo = -1
    await expect.ate(async () => {
      const log = await app.backend.invoke('app:gitLog', [])
      const quieto = log.length === ultimo && log.every((e) => e.durationMs !== undefined)
      ultimo = log.length
      return quieto
    }, 'processos git da resolução terminados')
    const gastos = [...(await ids())].filter((id) => !antes.has(id)).length
    expect.verdadeiro(gastos <= 5, `resolver + atualizar gastou ${gastos} processos git (teto 5)`)

    // Só o arquivo do meio saiu do conflito: os outros 199 continuam, na mesma ordem.
    const depois = caminhosDoIndice(await app.git('ls-files', '--unmerged'))
    expect.igual(depois, emConflito.filter((caminho) => caminho !== meio), 'arquivos ainda em conflito no índice')
    expect.igual((await app.git('diff', '--name-only', '--diff-filter=U')).trim().split('\n').length, ARQUIVOS - 1, 'arquivos em conflito no git')
    const conteudo = await readFile(join(dir, meio), 'utf8')
    expect.igual(conteudo, `nosso ${indice}\n`, 'arquivo do meio igual ao lado nosso')
    expect.igual(conteudo, await app.git('show', `HEAD:${meio}`), 'arquivo do meio igual ao HEAD')
    expect.verdadeiro(!/^(<<<<<<<|=======|>>>>>>>)/m.test(conteudo), 'o arquivo ainda tem marcadores de conflito')
    const aberta = await access(join(dir, '.git', 'CHERRY_PICK_HEAD')).then(() => true, () => false)
    expect.verdadeiro(aberta, 'o cherry-pick deveria seguir aberto até Continue')
  }
}

/** Caminho do arquivo n dentro de lote/ (três dígitos: a ordem de texto do git é a ordem numérica). */
function nomeDe(n) {
  return `lote/arq-${String(n).padStart(3, '0')}.txt`
}
