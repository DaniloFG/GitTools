// Abrir um repositório: a barra mostra o nome, a branch atual e o commit do HEAD que o git de verdade informa.
export default {
  id: 'abrir-repositorio',
  tela: 'Repositório',
  area: 'repositorio',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    const { dir } = await app.repoNovo({ wip: false, nome: 'abrir-e2e' })
    const branch = (await app.git('branch', '--show-current')).trim()
    const head = (await app.git('rev-parse', 'HEAD')).trim()
    const commits = Number((await app.git('rev-list', '--all', '--count')).trim())
    expect.igual(branch, 'main', 'branch atual no git')

    await app.aba('History')
    await expect.visivel('.commit-row', 5)
    const tela = await app.page.evaluate(() => ({
      repo: document.querySelector('.repo-button strong')?.textContent,
      caminho: document.querySelector('.repo-button')?.getAttribute('title'),
      branch: document.querySelector('.current-branch')?.textContent?.replace('⎇', '').trim(),
      sha: document.querySelector('.commit-row .commit-sha')?.textContent?.trim() ?? '',
      etiqueta: document.querySelector('.commit-row .ref-current')?.textContent?.replace('✓', '').trim()
    }))
    expect.igual(tela.repo, 'abrir-e2e', 'nome do repositório na barra')
    expect.igual(tela.caminho, dir, 'caminho do repositório na barra')
    expect.igual(tela.branch, branch, 'branch atual na barra')
    expect.verdadeiro(tela.sha.length >= 7 && head.startsWith(tela.sha), `commit do topo do histórico (${tela.sha}) não é o HEAD do git (${head})`)
    expect.igual(tela.etiqueta, branch, 'etiqueta da branch atual no commit do HEAD')
    // O cabeçalho do histórico diz "N commits": é o total de `git rev-list --all --count`.
    const contagem = await app.page.evaluate(() => [...document.querySelectorAll('.muted')].map((e) => e.textContent?.trim() ?? '').find((x) => /^\d+ commits?$/.test(x)) ?? '')
    expect.igual(contagem, `${commits} commits`, 'contagem de commits do histórico')
  }
}
