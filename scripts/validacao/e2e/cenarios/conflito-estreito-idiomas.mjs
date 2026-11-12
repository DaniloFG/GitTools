// #96/#149: tela Conflitos com o editor aberto em janela estreita (320, 480, 640 e 1000 px): a página não ganha
// rolagem horizontal e o rodapé do editor não cobre o corpo dele; e nos idiomas hi, ar (RTL) e zh-CN a tela abre sem
// quebrar a mesma régua. Capturas em validacao-out/conflitos-<idioma>-<largura>.png. A janela e o idioma voltam ao
// original no fim, mesmo se um passo falhar.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const LARGURAS = [320, 480, 640, 1000]
const IDIOMAS = ['hi', 'ar', 'zh-CN']
const ALTURA = 700

/** Régua na página: rolagem horizontal e sobreposição do rodapé do editor sobre o corpo (merge-editor). */
function medir() {
  const vw = document.documentElement.clientWidth
  const corpo = document.querySelector('.conflict-editor .merge-editor')?.getBoundingClientRect()
  const rodape = document.querySelector('.conflict-editor-foot')?.getBoundingClientRect()
  return {
    vw,
    rolagem: document.documentElement.scrollWidth - vw,
    editor: !!corpo,
    sobrepoe: corpo && rodape ? Math.round(corpo.bottom - rodape.top) : 0,
    rodapeFora: rodape ? Math.round(Math.max(-rodape.left, rodape.right - vw)) : 0,
    dir: getComputedStyle(document.body).direction
  }
}

export default {
  id: 'conflito-estreito-idiomas',
  tela: 'Conflitos',
  area: 'conflitos',
  orcamento: { ms: 60000, nos: 5000, erros: 0, git: 0 },
  escreve: true,
  async passos(app, expect) {
    await app.repoNovo({
      wip: false,
      nome: 'estreito-e2e',
      async preparar({ ids }) {
        await app.git('cherry-pick', ids.memberPrice).then(
          () => { throw new Error('o cherry-pick deveria parar em conflito') },
          (erro) => { if (erro.code !== 1) throw erro }
        )
      }
    })
    const original = app.page.viewportSize()
    const config = await app.backend.invoke('app:getSettings', [])
    const falhas = []
    try {
      await mkdir(join(process.cwd(), 'validacao-out'), { recursive: true })
      for (const lingua of ['en', ...IDIOMAS]) {
        await app.backend.invoke('app:saveSettings', [{ ...config, language: lingua, conflictStartup: 'open' }])
        await app.page.reload()
        await app.page.locator('.conflicts-screen').waitFor()
        await app.page.locator('.conflicts-row').first().click()
        await app.page.locator('.conflict-editor .merge-editor').waitFor()
        for (const largura of LARGURAS) {
          await app.page.setViewportSize({ width: largura, height: ALTURA })
          await expect.pagina((w) => document.documentElement.clientWidth === w, largura, `janela com ${largura} px`)
          let anterior = ''
          const m = await expect.ate(async () => {
            const atual = await app.page.evaluate(medir)
            const texto = JSON.stringify(atual)
            const assentou = texto === anterior
            anterior = texto
            return assentou ? atual : null
          }, `tela assentada em ${largura} px (${lingua})`)
          await app.page.screenshot({ path: join(process.cwd(), 'validacao-out', `conflitos-${lingua}-${largura}.png`) })
          // Todas as variantes são medidas antes de falhar: a primeira falha não esconde as outras.
          if (!m.editor) falhas.push(`${lingua} ${largura}: editor não abriu`)
          if (m.rolagem > 1) falhas.push(`${lingua} ${largura}: rolagem horizontal de ${m.rolagem} px`)
          if (m.sobrepoe > 1) falhas.push(`${lingua} ${largura}: rodapé cobre ${m.sobrepoe} px do editor`)
          if (m.rodapeFora > 1) falhas.push(`${lingua} ${largura}: rodapé fora da janela em ${m.rodapeFora} px`)
          if (lingua === 'ar' && m.dir !== 'rtl') falhas.push(`ar ${largura}: direção ${m.dir}, esperado rtl`)
        }
      }
      expect.igual(falhas, [], 'tela Conflitos estreita ou em outro idioma')
    } finally {
      await app.page.setViewportSize(original)
      await app.backend.invoke('app:saveSettings', [config])
    }
  }
}
