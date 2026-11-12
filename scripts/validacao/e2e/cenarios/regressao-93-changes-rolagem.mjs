// #93: com a lista de arquivos do Changes sozinha num painel à esquerda, poucos arquivos cabem sem rolagem e,
// quando a lista cresce, ela rola de verdade (há um contêiner rolável) e o último arquivo fica alcançável.
// O crescimento é real: arquivos novos no disco e um toque na pasta .git, que o observador do backend transforma
// no aviso de mudança que a interface já trata. Só leitura do app; o git confere a contagem.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const CHAVE = 'gittools.layout.dock'
const MUITOS = 60

/** Arranjo com a lista "Changes" sozinha à esquerda; o resto do Changes à direita. Painéis que faltam entram sozinhos. */
const DOCK = {
  version: 2,
  hidden: [],
  pinned: {},
  screenSizes: {},
  root: {
    kind: 'split',
    id: 'e2e-raiz',
    dir: 'row',
    sizes: [0.3, 0.7],
    children: [
      { kind: 'group', id: 'e2e-esquerda', views: ['changes.unstaged'], active: 'changes.unstaged' },
      {
        kind: 'split',
        id: 'e2e-direita',
        dir: 'column',
        sizes: [0.65, 0.35],
        children: [
          { kind: 'group', id: 'e2e-diff', views: ['changes.diff'], active: 'changes.diff' },
          { kind: 'group', id: 'e2e-lado', views: ['changes.staged', 'changes.commit'], active: 'changes.staged' }
        ]
      }
    ]
  }
}

export default {
  id: 'regressao-93-changes-rolagem',
  tela: 'Changes',
  area: 'alteracoes',
  orcamento: { ms: 20000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    try {
      await app.page.evaluate(([chave, dock]) => localStorage.setItem(chave, JSON.stringify(dock)), [CHAVE, DOCK])
      // Dois arquivos novos: poucos. O resto do exemplo fica limpo.
      const { dir } = await app.repoNovo({
        wip: false,
        nome: 'rolagem-e2e',
        async preparar({ dir: raiz }) {
          await writeFile(join(raiz, 'a.txt'), 'a\n')
          await writeFile(join(raiz, 'b.txt'), 'b\n')
        }
      })
      await app.aba('Changes')
      await expect.visivel('.csection-unstaged .file-item', 2)

      /** Estado da lista: onde está o painel e o contêiner rolável mais próximo dos itens. */
      const medir = () =>
        app.page.evaluate(() => {
          const painel = document.querySelector('[data-slot="changes.unstaged"]')?.getBoundingClientRect()
          const lista = document.querySelector('.csection-unstaged .file-list')
          let rolavel = null
          for (let el = lista?.parentElement; el && el !== document.body; el = el.parentElement) {
            const estilo = getComputedStyle(el).overflowY
            if (estilo === 'auto' || estilo === 'scroll') {
              rolavel = el
              break
            }
          }
          const itens = [...document.querySelectorAll('.csection-unstaged .file-item')]
          return {
            esquerda: painel ? Math.round(painel.left) : null,
            largura: painel ? Math.round(painel.width) : null,
            janela: window.innerWidth,
            temRolavel: !!rolavel,
            excesso: rolavel ? rolavel.scrollHeight - rolavel.clientHeight : null,
            itens: itens.length
          }
        })

      const poucos = await medir()
      expect.verdadeiro(poucos.esquerda !== null && poucos.esquerda < 40 && poucos.largura < poucos.janela * 0.5, `a lista deveria estar num painel à esquerda: ${JSON.stringify(poucos)}`)
      expect.verdadeiro(poucos.temRolavel, 'a lista deveria ter um contêiner rolável (overflow auto) mesmo com poucos arquivos')
      expect.verdadeiro(poucos.excesso <= 1, `com 2 arquivos a lista não deveria precisar rolar: ${JSON.stringify(poucos)}`)

      // A lista cresce: arquivos novos no disco e um toque na pasta .git para o observador avisar a interface.
      for (let i = 0; i < MUITOS; i++) await writeFile(join(dir, `muitos-${String(i).padStart(2, '0')}.txt`), `${i}\n`)
      await app.git('config', 'e2e.toque', 'cresceu')
      await expect.pagina((n) => Number(document.querySelector('.csection-unstaged .csection-count')?.textContent) === n + 2, MUITOS, `contador de Changes em ${MUITOS + 2}`)
      expect.igual((await app.git('status', '--porcelain', '-uall')).split('\n').filter(Boolean).length, MUITOS + 2, 'arquivos alterados no git')

      const muitos = await medir()
      expect.verdadeiro(muitos.temRolavel && muitos.excesso > 100, `com ${MUITOS + 2} arquivos a lista deveria ter o que rolar: ${JSON.stringify(muitos)}`)

      // Rolar de verdade até o fim: o scrollTop anda e o último item montado fica dentro da área visível do contêiner.
      const rolagem = await app.page.evaluate(() => {
        let el = document.querySelector('.csection-unstaged .file-list')?.parentElement
        while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY)) el = el.parentElement
        if (!el) return null
        el.scrollTop = el.scrollHeight
        const caixa = el.getBoundingClientRect()
        const itens = [...el.querySelectorAll('.file-item')]
        const ultimo = itens.at(-1)?.getBoundingClientRect()
        return { topo: el.scrollTop, ultimoDentro: !!ultimo && ultimo.top < caixa.bottom && ultimo.bottom > caixa.top }
      })
      expect.verdadeiro(rolagem !== null && rolagem.topo > 0, `a rolagem não andou: ${JSON.stringify(rolagem)}`)
      expect.verdadeiro(rolagem.ultimoDentro, 'depois de rolar, o último item deveria estar à vista')
    } finally {
      // O arranjo é do navegador, não do cenário: sem isto os seguintes abririam com a lista à esquerda.
      await app.page.evaluate((chave) => localStorage.removeItem(chave), CHAVE).catch(() => undefined)
    }
  }
}
