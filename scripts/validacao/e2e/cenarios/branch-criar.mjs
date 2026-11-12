// Criar branch pelo menu "New": com checkout, a nova branch vira a atual no HEAD de antes; sem checkout, nasce no
// mesmo commit e a atual continua. O nome com "/" é aceito. O git confere nos dois casos.
export default {
  id: 'branch-criar',
  tela: 'Branches',
  area: 'branches',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    await app.repoNovo({ wip: false, nome: 'criar-e2e' })
    const head = (await app.git('rev-parse', 'HEAD')).trim()
    const branches = async () => (await app.git('branch', '--format=%(refname:short)')).split('\n').filter(Boolean).sort()
    const atual = async () => (await app.git('branch', '--show-current')).trim()
    await app.aba('Branches')
    await expect.visivel('.branch-item', 4)

    async function criar(nome, comCheckout) {
      await app.page.locator('.tb-btn[data-tour="new"]').click()
      await app.page.locator('.context-menu button', { hasText: 'New branch' }).first().click()
      await app.page.locator('.modal').waitFor()
      await app.page.locator('.modal .field input').fill(nome)
      // A escolha de dar checkout é lembrada entre usos: cada passo diz o que quer.
      await app.page.locator('.modal input[type="checkbox"]').setChecked(comCheckout)
      await app.page.locator('.modal .modal-footer button.primary').click()
      await app.page.locator('.modal').waitFor({ state: 'detached' })
    }

    await criar('feature/e2e-nova', true)
    await expect.pagina(() => document.querySelector('.current-branch')?.textContent?.includes('feature/e2e-nova'), null, 'branch atual na barra')
    expect.igual(await atual(), 'feature/e2e-nova', 'branch atual no git')
    expect.igual((await app.git('rev-parse', 'HEAD')).trim(), head, 'HEAD depois de criar com checkout')
    expect.verdadeiro((await branches()).includes('feature/e2e-nova'), 'a branch criada deveria constar em git branch')

    await criar('sem/checkout', false)
    await expect.visivel('.branch-item[data-copy="sem/checkout"]', 1)
    expect.igual(await atual(), 'feature/e2e-nova', 'branch atual depois de criar sem checkout')
    expect.igual((await app.git('rev-parse', 'sem/checkout')).trim(), head, 'commit da branch criada sem checkout')
    expect.igual(await branches(), ['feature/e2e-nova', 'feature/login', 'feature/member-price', 'hotfix/readme', 'main', 'sem/checkout'], 'branches do repositório')
  }
}
