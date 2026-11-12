// Commit pela interface: só o que está no stage entra, com o assunto e o corpo digitados; o git confere o commit.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export default {
  id: 'changes-commit',
  tela: 'Changes',
  area: 'alteracoes',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    await app.repoNovo({
      wip: false,
      nome: 'commit-e2e',
      async preparar({ dir: raiz }) {
        await writeFile(join(raiz, 'README.md'), '# Acme Shop\n\nTexto novo.\n')
        await writeFile(join(raiz, 'nova.txt'), 'nova\n')
      }
    })
    const antes = Number((await app.git('rev-list', '--count', 'HEAD')).trim())
    const headAntes = (await app.git('rev-parse', 'HEAD')).trim()

    await app.aba('Changes')
    const linha = app.page.locator('.csection-unstaged .file-item[data-copy="README.md"]')
    await expect.visivel('.csection-unstaged .file-item[data-copy="README.md"]', 1)
    // Só o README vai para o stage; nova.txt fica de fora do commit.
    await linha.hover()
    await linha.locator('button[title="Stage"]').click()
    await expect.visivel('.csection-staged .file-item[data-copy="README.md"]', 1)

    await app.page.locator('.commit-box textarea').fill('Atualiza o README\n\nExplica o que mudou.')
    const botao = app.page.locator('.commit-box .commit-actions button')
    await expect.pagina(() => !document.querySelector('.commit-box .commit-actions button')?.disabled, null, 'botão de commit habilitado')
    await botao.click()

    // A caixa limpa e o arquivo sai de Staged quando o commit termina.
    await expect.pagina(() => document.querySelectorAll('.csection-staged .file-item').length === 0 && document.querySelector('.commit-box textarea')?.value === '', null, 'commit concluído na tela')
    expect.igual((await app.git('log', '-1', '--format=%s')).trim(), 'Atualiza o README', 'assunto do commit')
    expect.igual((await app.git('log', '-1', '--format=%b')).trim(), 'Explica o que mudou.', 'corpo do commit')
    expect.igual((await app.git('log', '-1', '--format=%an')).trim(), 'Ana Costa', 'autor do commit')
    expect.igual((await app.git('show', '--name-only', '--format=', 'HEAD')).split('\n').filter(Boolean), ['README.md'], 'arquivos do commit')
    expect.igual((await app.git('rev-parse', 'HEAD~1')).trim(), headAntes, 'pai do novo commit')
    expect.igual(Number((await app.git('rev-list', '--count', 'HEAD')).trim()), antes + 1, 'commits na branch')
    expect.igual((await app.git('status', '--porcelain')).split('\n').filter(Boolean), ['?? nova.txt'], 'o que sobrou fora do commit')
    // O que sobrou continua listado em Changes.
    await expect.visivel('.csection-unstaged .file-item[data-copy="nova.txt"]', 1)
  }
}
