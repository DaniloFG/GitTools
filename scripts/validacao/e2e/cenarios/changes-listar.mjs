// Alterações: as listas "Changes" e "Staged" têm exatamente os arquivos que `git status --porcelain` informa,
// com os contadores dos cabeçalhos iguais ao número de linhas de cada lista.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Caminhos de cada lista segundo o git: staged = coluna do índice; não staged = coluna da árvore (inclui `??`). */
function listasDoGit(porcelain) {
  const staged = []
  const naoStaged = []
  for (const linha of porcelain.split('\n').filter(Boolean)) {
    const x = linha[0]
    const y = linha[1]
    const caminho = linha.slice(3)
    if (x !== ' ' && x !== '?') staged.push(caminho)
    if (y !== ' ') naoStaged.push(caminho)
  }
  return { staged: staged.sort(), naoStaged: naoStaged.sort() }
}

export default {
  id: 'changes-listar',
  tela: 'Changes',
  area: 'alteracoes',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    // Além do trabalho em andamento do exemplo (um arquivo no stage, outro alterado): dois novos e um alterado.
    await app.repoNovo({
      wip: true,
      nome: 'listar-e2e',
      async preparar({ dir: raiz }) {
        await writeFile(join(raiz, 'solto.txt'), 'solto\n')
        await mkdir(join(raiz, 'pasta'), { recursive: true })
        await writeFile(join(raiz, 'pasta', 'novo.txt'), 'novo\n')
        await writeFile(join(raiz, 'README.md'), '# Acme Shop\n\nOutra linha.\n')
      }
    })
    const esperado = listasDoGit(await app.git('status', '--porcelain', '-uall'))
    expect.verdadeiro(esperado.staged.length > 0 && esperado.naoStaged.length > 3, `o git deveria ter alterações nas duas listas: ${JSON.stringify(esperado)}`)

    await app.aba('Changes')
    await expect.visivel('.csection-unstaged .file-item', esperado.naoStaged.length)
    await expect.visivel('.csection-staged .file-item', esperado.staged.length)
    const tela = await app.page.evaluate(() => {
      const lista = (secao) => [...document.querySelectorAll(`.csection-${secao} .file-item`)].map((e) => e.getAttribute('data-copy') ?? '').sort()
      const badge = (secao) => Number(document.querySelector(`.csection-${secao} .csection-count`)?.textContent)
      return { naoStaged: lista('unstaged'), staged: lista('staged'), badgeNaoStaged: badge('unstaged'), badgeStaged: badge('staged') }
    })
    expect.igual(tela.naoStaged, esperado.naoStaged, 'arquivos da lista Changes')
    expect.igual(tela.staged, esperado.staged, 'arquivos da lista Staged')
    expect.igual(tela.badgeNaoStaged, esperado.naoStaged.length, 'contador de Changes')
    expect.igual(tela.badgeStaged, esperado.staged.length, 'contador de Staged')
  }
}
