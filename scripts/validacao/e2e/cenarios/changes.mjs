// Alterações: a aba lista os arquivos alterados do repositório de exemplo.
export default {
  id: 'changes',
  tela: 'Changes',
  area: 'alteracoes',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    await app.page.locator('.screen-tab:not(.dashboards-tab)').filter({ hasText: 'Changes' }).first().click({ timeout: 10_000 })
    await expect.visivel('.file-item', 1)
  }
}
