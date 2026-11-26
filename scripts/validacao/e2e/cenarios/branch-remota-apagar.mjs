// Apagar branch REMOTA pelo menu de contexto (#279): o item aparece só na branch remota, pede confirmação; cancelar
// não toca no remoto e confirmar apaga a branch no remoto (conferido com `git ls-remote`), sem apagar a local.
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export default {
  id: 'branch-remota-apagar',
  tela: 'Branches',
  area: 'branches',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    let bare = ''
    await app.repoNovo({
      wip: false,
      nome: 'apagar-remota-e2e',
      async preparar({ dir }) {
        // O remoto bare fica ao lado do repositório, dentro da pasta temporária que o runner apaga ao fim.
        bare = join(dirname(dir), 'remoto.git')
        await mkdir(bare, { recursive: true })
        await execFileAsync('git', ['init', '-q', '--bare', bare])
        await app.git('branch', 'tmp/descartavel')
        await app.git('remote', 'add', 'origin', bare)
        await app.git('push', '-q', 'origin', 'tmp/descartavel')
      }
    })
    const noRemoto = async () => (await execFileAsync('git', ['ls-remote', '--heads', bare], { encoding: 'utf8' })).stdout.trim()
    const locais = async () => (await app.git('branch', '--format=%(refname:short)')).split('\n').filter(Boolean)
    expect.verdadeiro((await noRemoto()).includes('refs/heads/tmp/descartavel'), 'a branch deveria existir no remoto')

    await app.aba('Branches')
    // A seção do remoto começa recolhida: abre pelo cabeçalho.
    const remota = '.branch-item[data-copy="origin/tmp/descartavel"]'
    if ((await app.page.locator(remota).count()) === 0) await app.page.locator('.section-header', { hasText: 'Remote: origin' }).click()
    await expect.visivel(remota, 1)

    // A branch local não oferece o item.
    await app.page.locator('.branch-item[data-copy="tmp/descartavel"]').click({ button: 'right' })
    await app.page.locator('.context-menu').waitFor()
    expect.igual(await app.page.locator('.context-menu button', { hasText: 'Delete remote branch' }).count(), 0, 'item no menu da branch local')
    await app.page.keyboard.press('Escape')
    await app.page.locator('.context-menu').waitFor({ state: 'detached' })

    // Cancelar mantém a branch no remoto; confirmar a apaga.
    const apagar = async (confirmar) => {
      await app.page.locator(remota).click({ button: 'right' })
      await app.page.locator('.context-menu button', { hasText: 'Delete remote branch' }).click()
      await app.page.locator('.modal').waitFor()
      await app.page.locator('.modal .modal-footer button', { hasText: confirmar ? 'Yes, delete' : 'Cancel' }).click()
      await app.page.locator('.modal').waitFor({ state: 'detached' })
    }
    await apagar(false)
    expect.verdadeiro((await noRemoto()).includes('refs/heads/tmp/descartavel'), 'cancelar não pode apagar no remoto')
    await apagar(true)
    await expect.pagina(() => !document.querySelector('.branch-item[data-copy="origin/tmp/descartavel"]'), null, 'branch remota fora da lista')
    expect.igual(await noRemoto(), '', 'branches no remoto depois de apagar')
    expect.verdadeiro((await locais()).includes('tmp/descartavel'), 'a branch local continua')
  }
}
