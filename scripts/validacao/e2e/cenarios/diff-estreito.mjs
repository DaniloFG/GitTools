// #160: o cabeçalho do diff, com o caminho do arquivo, tem de ficar em uma linha só nas janelas (420, 560, 761, 900 e
// 1440 px), em en e em ar (RTL). O diretório encolhe com reticências e o nome do arquivo fica inteiro enquanto couber;
// o nome só é cortado depois que o diretório já sumiu. Antes da correção, o caminho quebrava no meio da palavra e o
// cabeçalho passava de uma linha. A 1440 px a lista de commits passa de 700 px, então a régua da coluna Autor com
// 140 px é conferida nesse ponto (o host electron do runner abre o histórico lado a lado com o diff nessa largura).
// Reprova se, em alguma largura e idioma: o cabeçalho passa de 40 px ou o caminho de 24 px (mais de uma linha); o
// `title` do caminho não é o completo (com `antigo → novo` na renomeação); o nome é cortado com o diretório ainda
// visível; o nome de 151 caracteres não aparece cortado com reticências; o painel do diff rola na horizontal; ou a
// coluna Autor do histórico não bate com a régua. Régua do Autor: `@container (max-width: 699px)` sobre `.commit-list`
// (styles.css, ~4351) zera a coluna quando a lista tem menos de 700 px de largura (clientWidth; a lista não tem
// padding, então é a mesma largura que a régua do CSS usa); a partir de 700 px ela fica com `--user-author`, que vale
// 140 por padrão (CommitList.tsx, DEFAULT_WIDTHS). Com as larguras deste cenário a lista fica abaixo de 700 px, então
// o ramo "140" pode não ser exercido aqui; a régua está escrita para os dois casos.
// A janela e o idioma voltam ao original no fim, mesmo se um passo falhar.
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const IDENTIDADE = ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com']
const LARGURAS = [420, 560, 761, 900, 1440]
const ALTURA = 700
const IDIOMAS = ['en', 'ar']

const DIR_A = 'pacotes/interface/componentes/painel-de-historico/subpasta-bem-longa'
const CAMINHO_A = `${DIR_A}/arquivo-razoavel.ts`
const DIR_B = 'pacotes/interface/componentes/painel-de-historico/pasta-de-destino-bem-longa/outra-subpasta'
const CAMINHO_B = `${DIR_B}/arquivo-razoavel.ts`
/** 151 caracteres: não cabe em nenhuma das larguras, então tem de sair cortado com reticências. */
const NOME_LONGO = `${'nome-de-arquivo-bem-comprido-'.repeat(5)}fim.ts`
const CAMINHO_C = `pacotes/${NOME_LONGO}`

const MSG_A = 'Adiciona arquivo de caminho longo e2e'
const MSG_B = 'Renomeia para pasta longa e2e'
const MSG_C = 'Adiciona arquivo de nome longo e2e'

/** Cada commit, o arquivo que ele mostra e o título que o caminho tem de levar. */
const CASOS = [
  { rotulo: 'caminho longo', mensagem: MSG_A, arquivo: 'arquivo-razoavel.ts', title: CAMINHO_A, cortado: false },
  { rotulo: 'renomeação', mensagem: MSG_B, arquivo: 'arquivo-razoavel.ts', title: `${CAMINHO_A} → ${CAMINHO_B}`, cortado: false },
  { rotulo: 'nome de 151 caracteres', mensagem: MSG_C, arquivo: NOME_LONGO, title: CAMINHO_C, cortado: true }
]

/**
 * Régua do cabeçalho do diff e da coluna Autor, lidas na página. `nomeCortado` é o scrollWidth contra o clientWidth do
 * nome; `dirW` é a largura do diretório (0 quando ele já sumiu, o que o nome precisa para começar a cortar).
 */
function medir() {
  const cabecalho = document.querySelector('[data-slot="commit.diff"] .diff-file-header')
  const caminho = cabecalho?.querySelector('.diff-path')
  const dir = caminho?.querySelector('.diff-path-dir')
  const nome = caminho?.querySelector('.diff-path-name')
  const painel = document.querySelector('[data-slot="commit.diff"] .diff-panel')
  const espacador = cabecalho?.querySelector('.toolbar-spacer')
  const lista = document.querySelector('.commit-list')
  const cabAutor = document.querySelector('.commit-columns .commit-author')
  const linhaAutor = document.querySelector('.commit-row .commit-author')
  return {
    cabecalho: cabecalho ? Math.round(cabecalho.getBoundingClientRect().height) : null,
    caminho: caminho ? Math.round(caminho.getBoundingClientRect().height) : null,
    title: caminho?.getAttribute('title') ?? null,
    dirW: dir ? Math.round(dir.getBoundingClientRect().width) : null,
    nomeCortado: nome ? nome.scrollWidth > nome.clientWidth + 1 : null,
    /** Espaço livre do cabeçalho: com o nome cortado, ele tem de estar cheio pelo caminho (ver `avaliar`). */
    espacador: espacador ? Math.round(espacador.getBoundingClientRect().width) : null,
    painelRola: painel ? painel.scrollWidth > painel.clientWidth + 1 : null,
    dir: getComputedStyle(document.body).direction,
    listaW: lista ? lista.clientWidth : null,
    autorCab: cabAutor ? Math.round(cabAutor.getBoundingClientRect().width) : null,
    autorLinha: linhaAutor ? Math.round(linhaAutor.getBoundingClientRect().width) : null
  }
}

/** Falhas de um commit numa largura e num idioma; uma lista vazia é o que passa. */
function avaliar(caso, m, rotulo, idioma) {
  if (m.cabecalho === null || m.caminho === null) return [`${rotulo}: ${caso.rotulo}: cabeçalho do diff não encontrado`]
  const falhas = []
  if (m.painelRola === null) falhas.push('painel do diff não encontrado')
  if (m.title !== caso.title) falhas.push(`title "${m.title}", esperava "${caso.title}"`)
  if (m.cabecalho > 40) falhas.push(`cabeçalho com ${m.cabecalho} px (uma linha cabe em 40)`)
  if (m.caminho > 24) falhas.push(`caminho com ${m.caminho} px de altura (uma linha cabe em 24): quebrou em linhas`)
  if (m.nomeCortado && m.dirW > 1) falhas.push(`nome cortado com o diretório ainda com ${m.dirW} px: o corte começa pelo diretório`)
  // O caminho leva a sobra do cabeçalho: se o nome está cortado, o espaçador (flex: 1, sem conteúdo) não pode ter sobrado.
  if (m.nomeCortado && m.espacador > 2) falhas.push(`nome cortado com ${m.espacador} px de espaço livre no cabeçalho`)
  if (caso.cortado && !m.nomeCortado) falhas.push('nome de 151 caracteres sem reticências: deveria estar cortado')
  if (m.painelRola) falhas.push('painel do diff rola na horizontal')
  const direcao = idioma === 'ar' ? 'rtl' : 'ltr'
  if (m.dir !== direcao) falhas.push(`direção ${m.dir}, esperava ${direcao}`)
  return falhas.map((f) => `${rotulo}: ${caso.rotulo}: ${f}`)
}

/** Coluna Autor: as duas medidas batem, são 0 ou ≥ 60 px, e seguem a régua de 700 px da lista. */
function avaliarAutor(m, rotulo) {
  const falhas = []
  if (m.autorCab === null || m.autorLinha === null) return [`${rotulo}: coluna Autor não encontrada`]
  if (m.autorCab !== m.autorLinha) falhas.push(`Autor do cabeçalho ${m.autorCab} px, da linha ${m.autorLinha} px`)
  if (!(m.autorCab === 0 || m.autorCab >= 60)) falhas.push(`Autor com ${m.autorCab} px (ou 0, ou ≥ 60)`)
  const esperado = m.listaW < 700 ? 0 : 140
  if (m.autorCab !== esperado) falhas.push(`lista com ${m.listaW} px: Autor deveria ter ${esperado} px, tem ${m.autorCab}`)
  return falhas.map((f) => `${rotulo}: ${f}`)
}

export default {
  id: 'diff-estreito',
  tela: 'History',
  area: 'historico',
  orcamento: { ms: 60000, nos: 5000, erros: 0, git: 0 },
  async passos(app, expect) {
    await app.repoNovo({
      wip: false,
      nome: 'diff-estreito-e2e',
      // Os três commits são criados antes de a interface ler o repositório: caminho longo, renomeação para outra pasta
      // longa (com uma linha mudada) e um arquivo cujo nome tem 151 caracteres.
      async preparar({ dir }) {
        const git = (...args) => execFileAsync('git', [...IDENTIDADE, ...args], { cwd: dir })
        await mkdir(join(dir, DIR_A), { recursive: true })
        await writeFile(join(dir, CAMINHO_A), 'primeira versao\n')
        await git('add', '-A')
        await git('commit', '-q', '-m', MSG_A)
        await mkdir(join(dir, DIR_B), { recursive: true })
        await git('mv', CAMINHO_A, CAMINHO_B)
        await writeFile(join(dir, CAMINHO_B), 'primeira versao\nsegunda versao\n')
        await git('add', '-A')
        await git('commit', '-q', '-m', MSG_B)
        await mkdir(join(dir, 'pacotes'), { recursive: true })
        await writeFile(join(dir, CAMINHO_C), 'nome longo\n')
        await git('add', '-A')
        await git('commit', '-q', '-m', MSG_C)
      }
    })
    await app.aba('History')
    await expect.visivel('.commit-row', 5)

    const original = app.page.viewportSize()
    const config = await app.backend.invoke('app:getSettings', [])
    const falhas = []
    /** Seleciona o commit e o arquivo, e espera a página mostrar o arquivo (não o anterior). */
    const abrir = async (caso) => {
      await app.page.locator('.commit-row', { hasText: caso.mensagem }).first().click()
      await expect.pagina((s) => document.querySelector('[data-slot="commit.message"] h3')?.textContent === s, caso.mensagem, `detalhes de ${caso.mensagem}`)
      await app.page.locator('[data-slot="commit.files"] .file-item', { hasText: caso.arquivo }).first().click()
      await expect.pagina((s) => document.querySelector('[data-slot="commit.diff"] .diff-path')?.textContent.includes(s), caso.arquivo, `diff de ${caso.arquivo}`)
    }
    try {
      for (const idioma of IDIOMAS) {
        if (idioma === 'ar') {
          // Troca o idioma pelas configurações, como conflito-estreito-idiomas.mjs, e recarrega. A aba do histórico
          // precisa continuar aberta; o cenário confere pela lista de commits, que não depende do texto da aba.
          await app.backend.invoke('app:saveSettings', [{ ...config, language: 'ar' }])
          await app.page.reload()
          await expect.visivel('.commit-row', 5)
        }
        for (const largura of LARGURAS) {
          await app.page.setViewportSize({ width: largura, height: ALTURA })
          await expect.pagina((w) => document.documentElement.clientWidth === w, largura, `janela com ${largura} px`)
          for (const caso of CASOS) {
            await abrir(caso)
            const rotulo = `${idioma} ${largura} px`
            // Espera o layout assentar: duas leituras iguais seguidas. A medida é do DOM, nunca de tempo fixo.
            let anterior = ''
            const m = await expect.ate(async () => {
              const atual = await app.page.evaluate(medir)
              const texto = JSON.stringify(atual)
              const assentou = texto === anterior
              anterior = texto
              return assentou ? atual : null
            }, `cabeçalho assentado (${caso.rotulo}, ${rotulo})`)
            falhas.push(...avaliar(caso, m, rotulo, idioma))
            if (idioma === 'en') falhas.push(...avaliarAutor(m, rotulo))
          }
        }
      }
      expect.igual(falhas, [], 'cabeçalho do diff estreito, idiomas e coluna Autor')
    } finally {
      if (original) await app.page.setViewportSize(original)
      await app.backend.invoke('app:saveSettings', [config])
    }
  }
}
