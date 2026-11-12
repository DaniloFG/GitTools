// Painéis: a aba de dashboards tem a grade de gráficos desenhada.
export default {
  id: 'dashboard',
  tela: 'Dashboard',
  area: 'dashboards',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    await app.page.locator('.dashboards-tab').click({ timeout: 10_000 })
    await expect.visivel('.dash-grid > *', 1)
  }
}
