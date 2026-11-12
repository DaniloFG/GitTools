// Stage e unstage pelos botões da linha: o git confirma com `git diff --cached --name-only` a cada passo.
export default {
  id: 'changes-stage-unstage',
  tela: 'Changes',
  area: 'alteracoes',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    // O exemplo já traz docs/notes.md no stage e src/cart.js alterado fora dele.
    await app.repoNovo({ wip: true, nome: 'stage-e2e' })
    const noStage = async () => (await app.git('diff', '--cached', '--name-only')).split('\n').filter(Boolean).sort()
    expect.igual(await noStage(), ['docs/notes.md'], 'stage antes de começar')

    await app.aba('Changes')
    const linha = (secao, caminho) => app.page.locator(`.csection-${secao} .file-item[data-copy="${caminho}"]`)
    // Os botões da linha só aparecem com o mouse sobre ela (CSS :hover): o ponteiro vai primeiro.
    const botao = async (secao, caminho, titulo) => {
      await linha(secao, caminho).hover()
      await linha(secao, caminho).locator(`button[title="${titulo}"]`).click()
    }
    await expect.visivel('.csection-unstaged .file-item[data-copy="src/cart.js"]', 1)

    // Stage: o botão "＋" da linha leva o arquivo para o índice e para a lista Staged.
    await botao('unstaged', 'src/cart.js', 'Stage')
    await expect.visivel('.csection-staged .file-item[data-copy="src/cart.js"]', 1)
    expect.igual(await noStage(), ['docs/notes.md', 'src/cart.js'], 'stage depois de adicionar src/cart.js')
    expect.igual(await app.page.locator('.csection-unstaged .file-item').count(), 0, 'linhas em Changes depois do stage')

    // Unstage: o botão "－" tira o arquivo do índice, sem tocar no conteúdo da árvore.
    await botao('staged', 'src/cart.js', 'Unstage')
    await expect.visivel('.csection-unstaged .file-item[data-copy="src/cart.js"]', 1)
    expect.igual(await noStage(), ['docs/notes.md'], 'stage depois de remover src/cart.js')
    const status = await app.git('status', '--porcelain')
    expect.verdadeiro(/^ M src\/cart\.js$/m.test(status), `src/cart.js deveria seguir alterado na árvore: ${JSON.stringify(status)}`)

    // "Unstage all" esvazia o índice e a lista Staged.
    await app.page.locator('.csection-staged .csection-actions button', { hasText: 'Unstage all' }).click()
    await expect.pagina(() => document.querySelectorAll('.csection-staged .file-item').length === 0, null, 'lista Staged vazia')
    expect.igual(await noStage(), [], 'stage depois de "Unstage all"')
  }
}
