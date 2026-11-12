// Commit feito por fora logo depois de uma ação própria (Stage pela linha): a tela tem de refletir o commit sem recarregar
// e sem o aviso ser engolido como eco da ação. O git de fora roda com execFile, direto: se passasse pelo `runGit` do
// Backend (como `app.git`), o backend o contaria como comando próprio e a alteração pareceria nossa.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Maior id de comando git que o backend já registrou (o log só cresce; ids são sequenciais). */
const ultimoId = async (app) => (await app.backend.invoke('app:gitLog', [])).reduce((maior, e) => Math.max(maior, e.id), 0)

export default {
  id: 'changes-alteracao-externa-apos-acao',
  tela: 'Changes',
  area: 'alteracoes',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    // O exemplo já traz docs/notes.md no stage e src/cart.js alterado fora dele. `app.dir` é o repositório do roteiro,
    // não este: o commit de fora vai para o `dir` que o repoNovo devolve.
    const { dir } = await app.repoNovo({ wip: true, nome: 'alteracao-externa-e2e' })
    await app.aba('Changes')
    const linha = (secao, caminho) => app.page.locator(`.csection-${secao} .file-item[data-copy="${caminho}"]`)
    await expect.visivel('.csection-unstaged .file-item[data-copy="src/cart.js"]', 1)

    // Ação própria pela tela: o "＋" da linha (o ponteiro passa antes, como no cenário de stage/unstage).
    const antes = await ultimoId(app)
    await linha('unstaged', 'src/cart.js').hover()
    await linha('unstaged', 'src/cart.js').locator('button[title="Stage"]').click()
    // Espera o `git add` do stage terminar, pelo log do próprio backend (não pela lista da tela). Só então o commit de
    // fora sai, logo em seguida: a alteração cai dentro da janela em que o aviso ainda seria tomado como eco.
    await expect.ate(async () => (await app.backend.invoke('app:gitLog', [])).some((e) => e.id > antes && e.args[0] === 'add' && e.durationMs !== undefined), 'o stage terminou no backend')

    // Commit de fora: leva o que está no stage (docs/notes.md e src/cart.js). Identidade e assinatura fixas por -c.
    await execFileAsync('git', ['-c', 'user.name=Teste', '-c', 'user.email=teste@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'commit externo'], { cwd: dir })

    // Sem recarregar e sem emitir aviso à mão: a própria interface tem de ver o commit de fora e esvaziar Staged.
    await expect.pagina(() => document.querySelectorAll('.csection-staged .file-item').length === 0, null, 'lista Staged sem os arquivos commitados por fora')
    expect.igual((await app.git('diff', '--cached', '--name-only')).trim(), '', 'índice limpo depois do commit de fora')
    expect.igual((await app.git('log', '-1', '--format=%s')).trim(), 'commit externo', 'último commit é o de fora')
  }
}
