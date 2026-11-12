// Lógica pura do ponta a ponta (scripts/validacao/e2e/runner.mjs): valida os cenários, compara o medido com o
// orçamento e monta os relatórios. Sem Playwright e sem fs, para o teste (tests/e2e-runner.test.ts) cobrir sem
// subir o app.

const ID_VALIDO = /^[a-z0-9][a-z0-9-]*$/
const CAMPOS_ORCAMENTO = ['ms', 'nos', 'erros', 'git']
const ROTULO_ORCAMENTO = {
  ms: 'tempo (ms)',
  nos: 'nós no DOM',
  erros: 'erros de página',
  git: 'processos git inesperados'
}

/**
 * Problemas de um cenário; lista vazia quer dizer válido. O id vira nome do arquivo de print, por isso só entra
 * minúscula, número e hífen (nada de barra nem de ponto).
 * @param {unknown} c o `export default` do arquivo do cenário (campos opcionais: `escreve`, `gitTolerado`)
 * @param {ReadonlySet<string>} jaVistos ids dos cenários já aceitos antes deste
 * @returns {string[]}
 */
export function validarCenario(c, jaVistos) {
  if (typeof c !== 'object' || c === null) return ['o cenário não é um objeto']
  const { id, tela, area, orcamento, passos, escreve, gitTolerado } = c
  const erros = []
  const nome = typeof id === 'string' && id !== '' ? `"${id}"` : '(sem id)'
  if (typeof id !== 'string' || id === '') erros.push('id ausente')
  else if (!ID_VALIDO.test(id)) erros.push(`id ${nome} fora do padrão (minúsculas, números e "-")`)
  else if (jaVistos.has(id)) erros.push(`id duplicado: ${nome}`)
  if (typeof tela !== 'string' || tela === '') erros.push(`${nome}: tela ausente`)
  if (typeof area !== 'string' || area === '') erros.push(`${nome}: area ausente`)
  if (typeof passos !== 'function') erros.push(`${nome}: passos ausentes`)
  // Opcionais: o cenário que altera o repositório de propósito e as saídas ≠ 0 do git que ele não pode evitar.
  if (escreve !== undefined && typeof escreve !== 'boolean') erros.push(`${nome}: escreve deve ser true ou false`)
  if (gitTolerado !== undefined && (!Array.isArray(gitTolerado) || !gitTolerado.every((re) => re instanceof RegExp))) {
    erros.push(`${nome}: gitTolerado deve ser uma lista de expressões regulares`)
  }
  if (typeof orcamento !== 'object' || orcamento === null) {
    erros.push(`${nome}: orçamento ausente`)
  } else {
    for (const campo of CAMPOS_ORCAMENTO) {
      const valor = orcamento[campo]
      if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) erros.push(`${nome}: orçamento.${campo} ausente ou inválido`)
    }
  }
  return erros
}

/**
 * Violações do orçamento. Passa no limite exato: só acima dele reprova.
 * @param {{ ms: number, nos: number, erros: number, git: number }} medido
 * @param {{ ms: number, nos: number, erros: number, git: number }} orcamento
 * @returns {string[]}
 */
export function avaliarOrcamento(medido, orcamento) {
  const violacoes = []
  for (const campo of CAMPOS_ORCAMENTO) {
    if (medido[campo] > orcamento[campo]) violacoes.push(`${ROTULO_ORCAMENTO[campo]}: ${medido[campo]} acima do orçamento de ${orcamento[campo]}`)
  }
  return violacoes
}

/**
 * Relatório do ponta a ponta. Sem nenhum cenário não há o que afirmar: não é ok. As chaves saem sempre na mesma
 * ordem e cada cenário só leva os campos do relatório, para o JSON ser estável entre execuções.
 * @param {{ quando: string, cenarios: { id: string, tela: string, area: string, ms: number, nos: number, ok: boolean, motivo: string }[] }} dados
 */
export function montarRelatorioE2e({ quando, cenarios }) {
  const itens = cenarios.map(({ id, tela, area, ms, nos, ok, motivo }) => ({ id, tela, area, ms, nos, ok, motivo }))
  const falhas = itens.filter((c) => !c.ok).length
  return { quando, ok: itens.length > 0 && falhas === 0, total: itens.length, falhas, cenarios: itens }
}

/** Escapa o texto para atributo e conteúdo XML. Caractere de controle não existe em XML: vira "?". */
function escapar(texto) {
  return String(texto)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '?')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const segundos = (ms) => (ms / 1000).toFixed(3)

/**
 * Relatório JUnit: um testcase por cenário (classname = tela, name = id), com `<failure>` no que falhou.
 * @param {{ cenarios: { id: string, tela: string, ms: number, ok: boolean, motivo: string }[], total: number, falhas: number }} relatorio
 */
export function gerarJunit(relatorio) {
  const tempo = relatorio.cenarios.reduce((soma, c) => soma + c.ms, 0)
  const linhas = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="e2e" tests="${relatorio.total}" failures="${relatorio.falhas}" time="${segundos(tempo)}">`
  ]
  for (const c of relatorio.cenarios) {
    const atributos = `classname="${escapar(c.tela)}" name="${escapar(c.id)}" time="${segundos(c.ms)}"`
    if (c.ok) {
      linhas.push(`  <testcase ${atributos}/>`)
    } else {
      linhas.push(`  <testcase ${atributos}>`)
      linhas.push(`    <failure message="${escapar(c.motivo)}">${escapar(c.motivo)}</failure>`)
      linhas.push('  </testcase>')
    }
  }
  linhas.push('</testsuite>')
  return linhas.join('\n') + '\n'
}
