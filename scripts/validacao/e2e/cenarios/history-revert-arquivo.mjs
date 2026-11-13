// History: o menu de contexto de um arquivo em "Commit files" traz "Revert this file" e "Revert before this file", entre
// "Take this file to …" e "Blame / history". "Revert this file" deixa o arquivo como estava no commit escolhido;
// "Revert before this file" o deixa como estava no pai desse commit. Nos dois casos o resultado vai para o stage e para a
// pasta de trabalho, e o git confirma. Com alteração local no arquivo, aparece o aviso de sobrescrever: cancelar não
// muda nada e confirmar aplica. Altera o repositório de exemplo (próprio do cenário).
// Os commits escolhidos nunca são o raiz: o diff dele começa por uma tentativa com `sha^` que sai com 128 de propósito
// (o app cai na árvore vazia), e o runner conta todo git que sai com erro como inesperado.

/** Itens do menu aberto, na ordem, sem o "⧉ " que enfeita "Open in new window". */
const ITENS = '.context-menu .menu-item'
const TAKE = /^Take this file to .+…$/

export default {
  id: 'history-revert-arquivo',
  tela: 'History',
  area: 'historico',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    // Sem trabalho em andamento: nenhum arquivo tem alteração local no começo, então o aviso só aparece quando o cenário o provoca.
    const { ids } = await app.repoNovo({ wip: false, nome: 'revert-arquivo-e2e' })
    await app.aba('History')
    await expect.visivel('.commit-row', 5)

    const arquivo = (caminho) => app.page.locator(`[data-slot="commit.files"] .file-item[data-path="${caminho}"]`)

    /** Escolhe o commit pelo assunto e espera a lista de arquivos dele chegar. */
    async function escolher(assunto, caminho) {
      await app.page.locator('.commit-row', { hasText: assunto }).click()
      await expect.pagina((s) => document.querySelector('[data-slot="commit.message"] h3')?.textContent === s, assunto, `detalhes de "${assunto}"`)
      await expect.pagina((c) => !!document.querySelector(`[data-slot="commit.files"] .file-item[data-path="${CSS.escape(c)}"]`), caminho, `${caminho} na lista de "${assunto}"`)
    }

    /** Abre o menu do arquivo e devolve os itens (texto) na ordem em que aparecem. */
    async function abrirMenu(caminho) {
      await arquivo(caminho).first().click({ button: 'right' })
      await expect.visivel(ITENS, 5)
      return app.page.evaluate((seletor) => [...document.querySelectorAll(seletor)].map((e) => (e.textContent ?? '').replace(/^⧉\s*/, '').trim()), ITENS)
    }

    const clicarItem = (rotulo) => app.page.locator(ITENS, { hasText: rotulo }).first().click()
    const naRevisao = (rev, caminho) => app.git('show', `${rev}:${caminho}`)
    const noStage = (caminho) => app.git('show', `:${caminho}`)
    const pastaIgualAoStage = async () => (await app.git('diff', '--name-only')).trim() === ''
    const status = async () => (await app.git('status', '--porcelain')).trim()

    // 1. "Revert this file" num arquivo sem alteração local: sem aviso, arquivo como no commit, no stage e na pasta.
    await escolher('Cart: count items', 'src/cart.js')
    const itens = await abrirMenu('src/cart.js')
    expect.igual(itens.slice(0, 2), ['Show diff', 'Open in new window'], 'primeiros itens do menu do arquivo')
    expect.verdadeiro(TAKE.test(itens[2] ?? ''), `o terceiro item deveria ser "Take this file to …", achei ${JSON.stringify(itens[2])}`)
    expect.igual(itens.slice(3, 6), ['Revert this file', 'Revert before this file', 'Blame / history'], 'itens depois do "Take this file to …"')
    await clicarItem('Revert this file')

    const cartContagem = await naRevisao(ids.count, 'src/cart.js')
    expect.verdadeiro(cartContagem !== (await naRevisao('HEAD', 'src/cart.js')), 'o commit deveria ter outro conteúdo que o HEAD (dado do cenário)')
    await expect.ate(async () => (await noStage('src/cart.js')) === cartContagem, 'src/cart.js no stage como no commit "Cart: count items"')
    expect.verdadeiro(await pastaIgualAoStage(), 'a pasta de trabalho deveria ficar igual ao stage depois de "Revert this file"')
    expect.igual(await status(), 'M  src/cart.js', 'status depois de "Revert this file"')
    expect.igual(await app.page.locator('.modal').count(), 0, 'arquivo sem alteração local não pede confirmação')

    // 2. "Revert before this file": o arquivo fica como no pai do commit escolhido (o commit dos erros de digitação mexeu no README.md).
    await escolher('Fix README typos', 'README.md')
    const itens2 = await abrirMenu('README.md')
    expect.verdadeiro(itens2.includes('Revert before this file'), 'menu sem "Revert before this file"')
    await clicarItem('Revert before this file')

    const readmePai = await naRevisao(`${ids.readme}^`, 'README.md')
    expect.verdadeiro(readmePai !== (await naRevisao(ids.readme, 'README.md')), 'o pai deveria ter outro conteúdo (dado do cenário)')
    await expect.ate(async () => (await noStage('README.md')) === readmePai, 'README.md no stage como no pai do commit')
    expect.verdadeiro(await pastaIgualAoStage(), 'a pasta de trabalho deveria ficar igual ao stage depois de "Revert before this file"')
    expect.igual(await status(), 'M  README.md\nM  src/cart.js', 'status depois de "Revert before this file"')

    // 3. src/cart.js tem alteração local (passo 1): o aviso aparece, cancelar não muda nada e confirmar aplica.
    await escolher('Cart: discount codes', 'src/cart.js')
    await abrirMenu('src/cart.js')
    await clicarItem('Revert this file')
    await expect.visivel('.modal', 1)
    await app.page.locator('.modal-footer button', { hasText: 'Cancel' }).click()
    await expect.pagina(() => document.querySelectorAll('.modal').length === 0, null, 'aviso fechado ao cancelar')
    expect.igual(await noStage('src/cart.js'), cartContagem, 'src/cart.js depois de cancelar o aviso')

    await abrirMenu('src/cart.js')
    await clicarItem('Revert this file')
    await expect.visivel('.modal', 1)
    await app.page.locator('.modal-footer button.danger', { hasText: 'Overwrite' }).click()
    const cartDesconto = await naRevisao(ids.discount, 'src/cart.js')
    expect.verdadeiro(cartDesconto !== cartContagem, 'o commit de desconto deveria ter outro conteúdo (dado do cenário)')
    await expect.ate(async () => (await noStage('src/cart.js')) === cartDesconto, 'src/cart.js no stage como no commit "Cart: discount codes" depois de confirmar')
    expect.verdadeiro(await pastaIgualAoStage(), 'a pasta de trabalho deveria ficar igual ao stage depois de confirmar o aviso')
  }
}
