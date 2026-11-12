// History: escolher um commit mostra os dados, os arquivos e o diff que o git informa para ele (mensagem, autor,
// lista de arquivos, linhas somadas e removidas por arquivo). Só leitura.

/** Linhas de `git show --numstat`: caminho → { add, del }. */
function numstat(saida) {
  const por = {}
  for (const linha of saida.split('\n').filter(Boolean)) {
    const [add, del, ...caminho] = linha.split('\t')
    por[caminho.join('\t')] = { add: Number(add), del: Number(del) }
  }
  return por
}

export default {
  id: 'history-diff-commit',
  tela: 'History',
  area: 'historico',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    const { ids } = await app.repoNovo({ wip: false, nome: 'historico-e2e' })
    await app.aba('History')
    await expect.visivel('.commit-row', 5)

    async function conferir(assunto, sha, arquivoComDiff) {
      await app.page.locator('.commit-row', { hasText: assunto }).click()
      const esperado = numstat(await app.git('show', '--numstat', '--format=', sha))
      const caminhos = Object.keys(esperado).sort()
      const [autor, email] = (await app.git('log', '-1', '--format=%an%n%ae', sha)).trim().split('\n')

      await expect.pagina((s) => document.querySelector('[data-slot="commit.message"] h3')?.textContent === s, assunto, `detalhes de "${assunto}"`)
      await expect.pagina((n) => document.querySelectorAll('[data-slot="commit.files"] .file-item').length === n, caminhos.length, `${caminhos.length} arquivo(s) de "${assunto}"`)
      const tela = await app.page.evaluate(() => {
        const texto = (seletor) => document.querySelector(seletor)?.textContent ?? ''
        return {
          assunto: texto('[data-slot="commit.message"] h3'),
          autor: texto('[data-slot="commit.message"] .commit-meta span'),
          sha: texto('[data-slot="commit.message"] .commit-meta code'),
          arquivos: [...document.querySelectorAll('[data-slot="commit.files"] .file-item')].map((e) => ({
            caminho: e.getAttribute('data-path'),
            add: Number(e.querySelector('.line-stats .add')?.textContent?.replace('+', '')),
            del: Number(e.querySelector('.line-stats .del')?.textContent?.replace('−', ''))
          }))
        }
      })
      expect.igual(tela.assunto, (await app.git('log', '-1', '--format=%s', sha)).trim(), 'assunto do commit')
      expect.igual(tela.autor, `${autor} <${email}>`, 'autor do commit')
      expect.verdadeiro(tela.sha.length >= 7 && sha.startsWith(tela.sha), `sha na tela (${tela.sha}) não é o do commit (${sha})`)
      expect.igual(tela.arquivos.map((a) => a.caminho).sort(), caminhos, 'arquivos do commit')
      for (const a of tela.arquivos) expect.igual({ add: a.add, del: a.del }, esperado[a.caminho], `linhas de ${a.caminho}`)

      // O diff mostra o arquivo escolhido, com tantas linhas somadas e removidas quanto o git conta.
      await app.page.locator('[data-slot="commit.files"] .file-item', { hasText: arquivoComDiff.split('/').pop() }).first().click()
      await expect.pagina((c) => document.querySelector('[data-slot="commit.diff"] .diff-path')?.textContent === c, arquivoComDiff, `diff de ${arquivoComDiff}`)
      const linhas = await app.page.evaluate(() => ({
        add: document.querySelectorAll('[data-slot="commit.diff"] tr.line-add').length,
        del: document.querySelectorAll('[data-slot="commit.diff"] tr.line-del').length
      }))
      expect.igual(linhas, esperado[arquivoComDiff], `linhas do diff de ${arquivoComDiff}`)
    }

    await conferir('Cart: discount codes', ids.discount, 'src/cart.js')
    // Trocar de commit troca tudo: outro assunto, outro arquivo, outras contagens.
    await conferir('Fix README typos', ids.readme, 'README.md')
  }
}
