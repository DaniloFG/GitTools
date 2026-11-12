// Git log: a aba mostra os comandos git que o app rodou (só leitura; a conferência de processos é do runner).
export default {
  id: 'gitlog',
  tela: 'Git log',
  area: 'git',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    await app.page.locator('.screen-tab:not(.dashboards-tab)').filter({ hasText: 'Git log' }).first().click({ timeout: 10_000 })
    await expect.visivel('.gitlog-command', 1)
  }
}
