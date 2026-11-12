// Apagar branch pelo menu de contexto: pede confirmação, a branch some do `git branch` e da lista; a branch atual
// não pode ser apagada (o item do menu fica desligado).
export default {
  id: 'branch-apagar',
  tela: 'Branches',
  area: 'branches',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    await app.repoNovo({
      wip: false,
      nome: 'apagar-e2e',
      async preparar() {
        await app.git('branch', 'tmp/descartavel')
      }
    })
    const branches = async () => (await app.git('branch', '--format=%(refname:short)')).split('\n').filter(Boolean).sort()
    expect.verdadeiro((await branches()).includes('tmp/descartavel'), 'a branch de partida deveria existir')
    await app.aba('Branches')
    await expect.visivel('.branch-item[data-copy="tmp/descartavel"]', 1)

    // A atual não se apaga.
    await app.page.locator('.branch-item[data-copy="main"]').click({ button: 'right' })
    const apagarAtual = app.page.locator('.context-menu button', { hasText: 'Delete' }).first()
    await apagarAtual.waitFor()
    expect.igual(await apagarAtual.isDisabled(), true, 'item Delete da branch atual desligado')
    await app.page.keyboard.press('Escape')
    await app.page.locator('.context-menu').waitFor({ state: 'detached' })

    // Cancelar mantém a branch; confirmar a apaga.
    const apagar = async (confirmar) => {
      await app.page.locator('.branch-item[data-copy="tmp/descartavel"]').click({ button: 'right' })
      await app.page.locator('.context-menu button', { hasText: 'Delete' }).first().click()
      await app.page.locator('.modal').waitFor()
      await app.page.locator('.modal .modal-footer button', { hasText: confirmar ? 'Delete' : 'Cancel' }).click()
      await app.page.locator('.modal').waitFor({ state: 'detached' })
    }
    await apagar(false)
    expect.verdadeiro((await branches()).includes('tmp/descartavel'), 'cancelar não pode apagar a branch')
    await apagar(true)
    await expect.pagina(() => !document.querySelector('.branch-item[data-copy="tmp/descartavel"]'), null, 'branch fora da lista')
    expect.igual(await branches(), ['feature/login', 'feature/member-price', 'hotfix/readme', 'main'], 'branches depois de apagar')
    expect.igual((await app.git('branch', '--show-current')).trim(), 'main', 'branch atual')
  }
}
