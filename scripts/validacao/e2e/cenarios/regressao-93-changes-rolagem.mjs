// #93: com a lista de arquivos do Changes sozinha num painel, poucos arquivos cabem sem rolagem e, quando a lista
// cresce, ela rola de verdade (há um contêiner rolável) e o último arquivo fica alcançável. A mesma prova roda em
// quatro arranjos (lista à esquerda, à direita, embaixo e numa janela baixa), porque a posição muda o espaço da lista.
// O crescimento é real: arquivos novos no disco e um toque na pasta .git, que o observador do backend transforma
// no aviso de mudança que a interface já trata. Só leitura do app; o git confere a contagem.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const CHAVE = 'gittools.layout.dock'
const MUITOS = 60

/** Arranjo completo a partir da raiz: nada escondido, nada fixado, sem tamanhos por tela (valem os `sizes`). */
const arranjo = (root) => ({ version: 2, hidden: [], pinned: {}, screenSizes: {}, root })

/** `esquerda`: a lista "Changes" sozinha à esquerda (0.3); o resto do Changes à direita (0.7). */
const DOCK_ESQUERDA = arranjo({
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
})

/** `direita`: diff, staged e commit à esquerda (0.7); a lista à direita (0.3). */
const DOCK_DIREITA = arranjo({
  kind: 'split',
  id: 'e2e-raiz',
  dir: 'row',
  sizes: [0.7, 0.3],
  children: [
    { kind: 'group', id: 'e2e-principal', views: ['changes.diff', 'changes.staged', 'changes.commit'], active: 'changes.diff' },
    { kind: 'group', id: 'e2e-lista', views: ['changes.unstaged'], active: 'changes.unstaged' }
  ]
})

/** `embaixo`: diff, staged e commit em cima (0.6); a lista embaixo (0.4). */
const DOCK_EMBAIXO = arranjo({
  kind: 'split',
  id: 'e2e-raiz',
  dir: 'column',
  sizes: [0.6, 0.4],
  children: [
    { kind: 'group', id: 'e2e-topo', views: ['changes.diff', 'changes.staged', 'changes.commit'], active: 'changes.diff' },
    { kind: 'group', id: 'e2e-lista', views: ['changes.unstaged'], active: 'changes.unstaged' }
  ]
})

/** Lista à esquerda: a posição conferida em `esquerda` e em `baixa`. */
const aEsquerda = (m) => m.esquerda !== null && m.esquerda < 40 && m.largura < m.janela * 0.5

/**
 * Cada variante tem repositório próprio e o mesmo roteiro. `janela` null usa o tamanho original da janela; `posicao`
 * diz se a lista está onde a variante quer, e `descreve` vai para a mensagem da falha.
 */
const VARIANTES = [
  { nome: 'esquerda', dock: DOCK_ESQUERDA, janela: null, descreve: 'num painel à esquerda', posicao: aEsquerda },
  { nome: 'direita', dock: DOCK_DIREITA, janela: null, descreve: 'num painel à direita (esquerda > janela * 0.5)', posicao: (m) => m.esquerda !== null && m.esquerda > m.janela * 0.5 },
  { nome: 'embaixo', dock: DOCK_EMBAIXO, janela: null, descreve: 'embaixo (topo > altura * 0.4)', posicao: (m) => m.topo !== null && m.topo > m.altura * 0.4 },
  { nome: 'baixa', dock: DOCK_ESQUERDA, janela: { width: 1100, height: 420 }, descreve: 'num painel à esquerda, na janela 1100x420', posicao: aEsquerda }
]

/** Estado da lista: onde está o painel, o tamanho da janela e o contêiner rolável mais próximo dos itens. */
const medir = (page) =>
  page.evaluate(() => {
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
      topo: painel ? Math.round(painel.top) : null,
      largura: painel ? Math.round(painel.width) : null,
      janela: window.innerWidth,
      altura: window.innerHeight,
      temRolavel: !!rolavel,
      excesso: rolavel ? rolavel.scrollHeight - rolavel.clientHeight : null,
      itens: itens.length
    }
  })

/** Um arranjo: grava o layout antes (o repositório recarrega a página e lê o que está gravado), abre o repositório e confere. */
async function rodarVariante(app, expect, v, original) {
  const { nome } = v
  await app.page.setViewportSize(v.janela ?? original)
  await app.page.evaluate(([chave, dock]) => localStorage.setItem(chave, JSON.stringify(dock)), [CHAVE, v.dock])
  // Dois arquivos novos: poucos. O resto do exemplo fica limpo. O nome é da variante: a espera pelo nome do
  // repositório na barra só passa quando é este que abriu.
  const { dir } = await app.repoNovo({
    wip: false,
    nome: `rolagem-e2e-${nome}`,
    async preparar({ dir: raiz }) {
      await writeFile(join(raiz, 'a.txt'), 'a\n')
      await writeFile(join(raiz, 'b.txt'), 'b\n')
    }
  })
  await app.aba('Changes')
  await expect.visivel('.csection-unstaged .file-item', 2)

  const poucos = await medir(app.page)
  expect.verdadeiro(v.posicao(poucos), `${nome}: a lista deveria estar ${v.descreve}: ${JSON.stringify(poucos)}`)
  expect.verdadeiro(poucos.temRolavel, `${nome}: a lista deveria ter um contêiner rolável (overflow auto) mesmo com poucos arquivos`)
  expect.verdadeiro(poucos.excesso <= 1, `${nome}: com 2 arquivos a lista não deveria precisar rolar: ${JSON.stringify(poucos)}`)

  // A lista cresce: arquivos novos no disco e um toque na pasta .git para o observador avisar a interface.
  for (let i = 0; i < MUITOS; i++) await writeFile(join(dir, `muitos-${String(i).padStart(2, '0')}.txt`), `${i}\n`)
  await app.git('config', 'e2e.toque', 'cresceu')
  await expect.pagina((n) => Number(document.querySelector('.csection-unstaged .csection-count')?.textContent) === n + 2, MUITOS, `${nome}: contador de Changes em ${MUITOS + 2}`)
  expect.igual((await app.git('status', '--porcelain', '-uall')).split('\n').filter(Boolean).length, MUITOS + 2, `${nome}: arquivos alterados no git`)

  const muitos = await medir(app.page)
  // Quantos itens ficam montados é só registrado, sem asserção. A lista monta em lotes de 300 (FileList.tsx,
  // ROW_BATCH): com 62 arquivos todos ficam montados, então não há "menos que 62" a afirmar.
  console.log(`${nome}: ${muitos.itens} .file-item montados com ${MUITOS + 2} arquivos`)
  expect.verdadeiro(muitos.temRolavel && muitos.excesso > 100, `${nome}: com ${MUITOS + 2} arquivos a lista deveria ter o que rolar: ${JSON.stringify(muitos)}`)

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
  expect.verdadeiro(rolagem !== null && rolagem.topo > 0, `${nome}: a rolagem não andou: ${JSON.stringify(rolagem)}`)
  expect.verdadeiro(rolagem.ultimoDentro, `${nome}: depois de rolar, o último item deveria estar à vista`)
}

export default {
  id: 'regressao-93-changes-rolagem',
  tela: 'Changes',
  area: 'alteracoes',
  // Quatro repositórios e quatro recargas numa execução só: o teto do cenário cobre as quatro variantes.
  orcamento: { ms: 20000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    const original = app.page.viewportSize()
    expect.verdadeiro(original !== null, 'a janela deveria ter tamanho')
    try {
      for (const v of VARIANTES) await rodarVariante(app, expect, v, original)
    } finally {
      // O arranjo e a janela são do navegador, não do cenário: sem isto os seguintes abririam com a lista num lugar só.
      await app.page.setViewportSize(original).catch(() => undefined)
      await app.page.evaluate((chave) => localStorage.removeItem(chave), CHAVE).catch(() => undefined)
    }
  }
}
