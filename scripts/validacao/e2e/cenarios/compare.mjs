// Comparar: a aba lista os arquivos diferentes entre as duas refs.
export default {
  id: 'compare',
  tela: 'Compare',
  area: 'comparacao',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    await app.page.locator('.screen-tab:not(.dashboards-tab)').filter({ hasText: 'Compare' }).first().click({ timeout: 10_000 })
    await expect.visivel('.file-item', 1)
  }
}
