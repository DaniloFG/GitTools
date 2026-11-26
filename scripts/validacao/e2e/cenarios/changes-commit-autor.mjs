// Amend com autor e data do autor trocados pela interface: as opções só existem com "Amend the last commit" marcado,
// vêm pré-preenchidas com os dados do HEAD e, preenchidas, refazem o último commit sem criar outro. O git confirma.
export default {
  id: 'changes-commit-autor',
  tela: 'Changes',
  area: 'alteracoes',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    await app.repoNovo({ wip: false, nome: 'commit-autor-e2e' })
    const commits = async () => Number((await app.git('rev-list', '--count', 'HEAD')).trim())
    const antes = await commits()
    const paiAntes = (await app.git('rev-parse', 'HEAD~1')).trim()
    const autorAntes = (await app.git('log', '-1', '--format=%an <%ae>')).trim()
    const assuntoAntes = (await app.git('log', '-1', '--format=%s')).trim()

    await app.aba('Changes')
    const opcoes = '.commit-box .commit-options'
    // Texto exato: "Set author" também está contido em "Set author date".
    const caixa = (rotulo) => app.page.locator(`${opcoes} label.checkbox`).filter({ hasText: new RegExp(`^${rotulo}$`) }).locator('input')
    const campoData = app.page.locator(`${opcoes} input[type="datetime-local"]`)
    const campoAutor = app.page.locator(`${opcoes} input[type="text"]`)
    const botao = app.page.locator('.commit-box .commit-actions button')

    // Sem amend as opções não aparecem.
    await expect.pagina(() => document.querySelectorAll('.commit-options label.checkbox').length === 2, null, 'só amend e push sem amend marcado')
    expect.igual(await caixa('Set author date').count(), 0, 'opção de data sem amend')
    expect.igual(await caixa('Set author').count(), 0, 'opção de autor sem amend')

    // Com amend, as duas aparecem; a mensagem do HEAD entra na caixa.
    await caixa('Amend the last commit').check()
    await expect.pagina(() => document.querySelector('.commit-box textarea')?.value.length > 0, null, 'mensagem do HEAD na caixa')
    await expect.pagina(() => document.querySelectorAll('.commit-options label.checkbox').length === 4, null, 'opções de autor com amend marcado')

    // Marcada, cada opção vem preenchida com o HEAD.
    await caixa('Set author date').check()
    await caixa('Set author').check()
    await expect.pagina((esperado) => document.querySelector('.commit-options input[type="text"]')?.value === esperado, autorAntes, 'autor do HEAD no campo')
    await expect.pagina(() => document.querySelector('.commit-options input[type="datetime-local"]')?.value.length > 0, null, 'data do HEAD no campo')

    // Autor inválido bloqueia o botão; o válido libera.
    await campoAutor.fill('sem-email')
    await expect.pagina(() => document.querySelector('.commit-box .commit-actions button')?.disabled === true, null, 'botão bloqueado com autor inválido')
    await campoAutor.fill('Maria Souza <maria@example.com>')
    await campoData.fill('2026-05-01T10:30')
    await expect.pagina(() => document.querySelector('.commit-box .commit-actions button')?.disabled === false, null, 'botão liberado com os dois campos válidos')

    // Desmarcar o amend esconde as opções (o que foi digitado fica guardado, mas não é enviado).
    await caixa('Amend the last commit').uncheck()
    await expect.pagina(() => document.querySelectorAll('.commit-options label.checkbox').length === 2, null, 'opções de autor somem sem amend')
    expect.igual(await campoAutor.count(), 0, 'campo de autor sem amend')
    await caixa('Amend the last commit').check()
    await expect.pagina(() => document.querySelectorAll('.commit-options label.checkbox').length === 4, null, 'opções de volta com amend marcado')

    await botao.click()
    // A caixa limpa e as opções somem quando o amend termina.
    await expect.pagina(() => document.querySelector('.commit-box textarea')?.value === '' && document.querySelectorAll('.commit-options label.checkbox').length === 2, null, 'amend concluído na tela')

    expect.igual((await app.git('log', '-1', '--format=%an <%ae>|%ad', '--date=format:%Y-%m-%dT%H:%M:%S')).trim(), 'Maria Souza <maria@example.com>|2026-05-01T10:30:00', 'autor e data do autor do último commit')
    expect.igual((await app.git('log', '-1', '--format=%s')).trim(), assuntoAntes, 'assunto mantido')
    expect.igual((await app.git('rev-parse', 'HEAD~1')).trim(), paiAntes, 'pai do commit refeito')
    expect.igual(await commits(), antes, 'número de commits')
  }
}
