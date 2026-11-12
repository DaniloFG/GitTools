// Trocar de branch com duplo clique na lista: o git passa a ter outro HEAD e a árvore de trabalho acompanha;
// voltar para a main restaura o estado de antes.
export default {
  id: 'branch-trocar',
  tela: 'Branches',
  area: 'branches',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    const { ids } = await app.repoNovo({ wip: false, nome: 'trocar-e2e' })
    const atual = async () => (await app.git('branch', '--show-current')).trim()
    const head = async () => (await app.git('rev-parse', 'HEAD')).trim()
    const arquivos = async () => (await app.git('ls-files', 'src/auth')).split('\n').filter(Boolean)
    expect.igual(await atual(), 'main', 'branch no começo')
    expect.igual(await arquivos(), [], 'src/auth na main')

    await app.aba('Branches')
    await expect.visivel('.branch-item', 4)
    await app.page.locator('.branch-item[data-copy="feature/login"]').dblclick()
    await expect.pagina(() => document.querySelector('.current-branch')?.textContent?.includes('feature/login'), null, 'feature/login como branch atual na barra')
    expect.igual(await atual(), 'feature/login', 'branch atual no git')
    expect.igual(await head(), ids.loginTests, 'HEAD em feature/login')
    expect.igual(await arquivos(), ['src/auth/login.js', 'src/auth/login.test.js'], 'src/auth em feature/login')
    expect.igual(await app.git('status', '--porcelain'), '', 'árvore limpa depois da troca')
    expect.igual(await app.page.locator('.branch-item.current').getAttribute('data-copy'), 'feature/login', 'item marcado como atual na lista')

    await app.page.locator('.branch-item[data-copy="main"]').dblclick()
    await expect.pagina(() => document.querySelector('.current-branch')?.textContent?.trim() === '⎇ main', null, 'main como branch atual na barra')
    expect.igual(await atual(), 'main', 'branch atual depois de voltar')
    expect.igual(await head(), ids.merge, 'HEAD de volta na main')
    expect.igual(await arquivos(), [], 'src/auth de volta na main')
  }
}
