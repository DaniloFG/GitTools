// Commit que não pode ser feito: sem mensagem, ou sem nada no stage, o botão fica desligado e o atalho Ctrl+Enter
// não cria commit. O git confirma que o número de commits não mudou.
export default {
  id: 'changes-commit-bloqueado',
  tela: 'Changes',
  area: 'alteracoes',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  // "Unstage all" escreve no índice; que nenhum commit nasce quem confere é o git (contagem de commits), não o orçamento.
  escreve: true,
  async passos(app, expect) {
    // O exemplo com trabalho em andamento tem docs/notes.md no stage.
    await app.repoNovo({ wip: true, nome: 'bloqueado-e2e' })
    const commits = async () => Number((await app.git('rev-list', '--count', 'HEAD')).trim())
    const antes = await commits()
    const desligado = () => app.page.evaluate(() => document.querySelector('.commit-box .commit-actions button')?.disabled)

    await app.aba('Changes')
    await expect.visivel('.csection-staged .file-item', 1)
    const mensagem = app.page.locator('.commit-box textarea')

    // Com algo no stage, mas sem mensagem.
    expect.igual(await desligado(), true, 'botão de commit sem mensagem')

    // Com mensagem e com o stage esvaziado.
    await mensagem.fill('Não deveria existir')
    await expect.pagina(() => document.querySelector('.commit-box .commit-actions button')?.disabled === false, null, 'botão habilitado com stage e mensagem')
    await app.page.locator('.csection-staged .csection-actions button', { hasText: 'Unstage all' }).click()
    await expect.pagina(() => document.querySelectorAll('.csection-staged .file-item').length === 0, null, 'lista Staged vazia')
    expect.igual(await desligado(), true, 'botão de commit sem nada no stage')
    // O atalho passa pela mesma regra: só avisa, não comita.
    await mensagem.press('Control+Enter')
    expect.igual(await commits(), antes, 'commits depois do Ctrl+Enter sem stage')
    expect.igual((await app.git('log', '-1', '--format=%s')).trim(), 'Merge hotfix/readme', 'assunto do último commit')
  }
}
