// Guardar no stash pelo menu "New": a árvore e o stage ficam limpos, `git stash list` ganha a entrada com a
// descrição digitada e a lista de Stashes na tela a mostra.
export default {
  id: 'stash-guardar',
  tela: 'Changes',
  area: 'stash',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    await app.repoNovo({ wip: true, nome: 'stash-e2e' })
    const lista = async () => (await app.git('stash', 'list', '--format=%gs')).split('\n').filter(Boolean)
    const antes = (await app.git('status', '--porcelain')).split('\n').filter(Boolean).sort()
    expect.igual(antes, ['A  docs/notes.md', ' M src/cart.js'].sort(), 'alterações antes de guardar')
    expect.igual(await lista(), [], 'stashes antes de guardar')

    await app.aba('Changes')
    await expect.visivel('.file-item', 2)
    await app.page.locator('.tb-btn[data-tour="new"]').click()
    await app.page.locator('.context-menu button', { hasText: 'Stash' }).first().click()
    await app.page.locator('.modal').waitFor()
    await app.page.locator('.modal .field input').fill('trabalho-em-andamento')
    await app.page.locator('.modal .modal-footer button.primary').click()
    await app.page.locator('.modal').waitFor({ state: 'detached' })

    await expect.pagina(() => document.querySelectorAll('.file-item').length === 0, null, 'listas de Changes vazias')
    expect.igual(await app.git('status', '--porcelain'), '', 'status depois de guardar')
    const guardados = await lista()
    expect.igual(guardados.length, 1, 'entradas em git stash list')
    expect.verdadeiro(guardados[0].includes('trabalho-em-andamento'), `a entrada do stash deveria ter a descrição: ${guardados[0]}`)
    expect.igual((await app.git('stash', 'show', '--name-only', 'stash@{0}')).split('\n').filter(Boolean).sort(), ['docs/notes.md', 'src/cart.js'], 'arquivos do stash')

    // A lista de stashes da tela mostra a mesma entrada.
    await app.aba('Branches')
    await expect.visivel('.stash-item', 1)
    expect.verdadeiro((await app.page.locator('.stash-item .branch-name').first().textContent()).includes('trabalho-em-andamento'), 'a lista de Stashes deveria mostrar a descrição')
  }
}
