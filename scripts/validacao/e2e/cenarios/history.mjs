// Histórico: a aba desenha as linhas de commit (o exemplo tem 11 commits).
export default {
  id: 'history',
  tela: 'History',
  area: 'historico',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    await app.page.locator('.screen-tab:not(.dashboards-tab)').filter({ hasText: 'History' }).first().click({ timeout: 10_000 })
    await expect.visivel('.commit-row', 5)
  }
}
