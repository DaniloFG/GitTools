// Branches: a aba lista as branches do repositório de exemplo (ao menos duas).
export default {
  id: 'branches',
  tela: 'Branches',
  area: 'branches',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    await app.page.locator('.screen-tab:not(.dashboards-tab)').filter({ hasText: 'Branches' }).first().click({ timeout: 10_000 })
    await expect.visivel('.branch-item', 2)
  }
}
