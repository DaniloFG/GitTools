// Cherry-pick Studio (#197): a lista de commits abre toda desmarcada, nada é trazido sem ser escolhido. Na aba
// Commits o botão de aplicar fica desabilitado até haver seleção; marcar um commit o habilita e o git confere que só
// ele foi trazido. Trocar a origem recarrega a lista, de novo sem nada marcado. "all" marca todos e "none" desmarca.
export default {
  id: 'studio-cherry-pick-desmarcado',
  tela: 'Cherry-pick Studio',
  area: 'studio',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    await app.repoNovo({ wip: false, nome: 'studio-e2e' })
    const { page } = app
    const origem = page.locator('.modal label.field.inline', { hasText: /^Source/ }).locator('select').last()
    const antes = (await app.git('rev-list', '--count', 'HEAD')).trim()

    await page.locator('.tb-btn[data-tour="studio"]').click()
    await page.locator('.modal').waitFor()
    await origem.selectOption('feature/login')
    await page.locator('.modal .tabs button', { hasText: 'Commits' }).click()
    await expect.visivel('.studio-commit-list li', 4)

    const marcados = () => page.locator('.studio-commit-list input[type="checkbox"]:checked').count()
    const aplicar = page.locator('.modal .modal-footer button.primary')
    expect.igual(await marcados(), 0, 'commits marcados ao abrir o Studio')
    expect.verdadeiro(await aplicar.isDisabled(), 'aplicar deveria estar desabilitado sem seleção')

    // Outra origem e de volta: a lista recarrega sem nada marcado.
    await origem.selectOption('feature/member-price')
    await expect.visivel('.studio-commit-list li', 1)
    expect.igual(await marcados(), 0, 'commits marcados depois de trocar a origem')
    await origem.selectOption('feature/login')
    await expect.visivel('.studio-commit-list li', 4)
    expect.igual(await marcados(), 0, 'commits marcados ao voltar à origem')

    // "all" e "none" continuam funcionando.
    await page.locator('.modal button.link', { hasText: /^all$/ }).first().click()
    await expect.ate(async () => (await marcados()) === 4, 'all marca todos os pendentes')
    await page.locator('.modal button.link', { hasText: /^none$/ }).first().click()
    await expect.ate(async () => (await marcados()) === 0, 'none desmarca todos')

    // Marcar explicitamente o commit mais antigo habilita aplicar e traz só ele.
    const ultima = page.locator('.studio-commit-list li').last()
    const assunto = (await ultima.locator('.commit-subject').textContent()).trim()
    await ultima.locator('input[type="checkbox"]').check()
    expect.verdadeiro(await aplicar.isEnabled(), 'aplicar deveria habilitar com um commit marcado')
    await aplicar.click()
    await page.locator('.modal').waitFor({ state: 'detached' })

    expect.igual((await app.git('rev-list', '--count', 'HEAD')).trim(), String(Number(antes) + 1), 'só um commit trazido')
    expect.igual((await app.git('log', '-1', '--format=%s')).trim(), assunto, 'assunto do commit trazido')
  }
}
