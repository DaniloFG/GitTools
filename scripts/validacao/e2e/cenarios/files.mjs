// Arquivos: a aba desenha a árvore de arquivos do repositório.
export default {
  id: 'files',
  tela: 'Files',
  area: 'arquivos',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    await app.page.locator('.screen-tab:not(.dashboards-tab)').filter({ hasText: 'Files' }).first().click({ timeout: 10_000 })
    await expect.visivel('.file-item', 1)
  }
}
