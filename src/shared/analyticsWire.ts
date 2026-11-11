// Formato colunar e compacto do resultado de `analytics` (dashboards) no transporte entre o backend e a interface,
// e também no cache em disco. Segue a mesma ideia do diffWire (Fase 3 de docs/PERFORMANCE.md).
//
// Por que: 20 mil commits em objetos `{ sha, author, email, ..., files: [[i, a, d], ...] }` repetem as mesmas chaves
// 20 mil vezes e repetem nomes e e-mails de autores a cada commit. Medido: 7,3 MB de JSON. Aqui cada campo vira uma
// coluna (um array por campo), nomes e e-mails de autor ficam numa tabela de pessoas (cada par aparece uma vez) e
// os commits guardam só o índice, as tags são esparsas (só commits com tag) e os arquivos viram uma lista única de
// trios [caminho, adicionadas, removidas] com a quantidade por commit.
//
// Tempos: cada coluna de tempo vai em segundos quando TODOS os valores são múltiplos exatos de 1000 (e a ida e volta
// reproduz o número); senão vai em milissegundos. O sinalizador `timeSec`/`commitTimeSec` diz qual foi usado.
// A conversão é sem perda: o encode confere a ida e volta antes de escolher segundos.
//
// O decode confere o tamanho de cada coluna e os índices, e lança erro claro quando algo não bate: um cache
// corrompido ou uma versão diferente nunca vira um resultado silenciosamente errado.
//
// Este módulo não depende de Node nem do navegador: é usado pelo backend (encode) e pela interface (decode).

import type { Analytics, AnalyticsCommit } from './types'

/** Marca o formato. Um Analytics comum não tem `wire`, então quem recebe distingue os dois. */
export const ANALYTICS_WIRE_VERSION = 'analytics-v1' as const

export interface AnalyticsWire {
  wire: typeof ANALYTICS_WIRE_VERSION
  scope: 'all' | 'head'
  truncated: boolean
  generatedAt: number
  /** Caminhos citados em `files` (igual a `Analytics.paths`). */
  paths: string[]

  /** Tabela de pessoas: pares (nome, e-mail) sem repetição. Autor e committer usam a mesma tabela. */
  peopleName: string[]
  peopleEmail: string[]

  // ---- uma posição por commit (todas as colunas têm o mesmo tamanho) ----
  sha: string[]
  /** Quantidade de pais. */
  parents: number[]
  /** Índice em `peopleName`/`peopleEmail` do autor. */
  author: number[]
  /** Índice em `peopleName`/`peopleEmail` do committer. */
  committer: number[]
  /** Data do autor: segundos se `timeSec`, senão milissegundos. */
  time: number[]
  timeSec: boolean
  /** Data do committer: segundos se `commitTimeSec`, senão milissegundos. */
  commitTime: number[]
  commitTimeSec: boolean
  subject: string[]
  bodyLength: number[]
  /** Um caractere por commit: '1' com Signed-off-by, '0' sem. String em vez de array de booleanos: 20 mil bytes. */
  signedOff: string
  coAuthors: number[]

  // ---- tags, só dos commits que têm alguma ----
  /** Índice do commit de cada entrada com tag. */
  tagCommit: number[]
  /** Quantidade de tags de cada entrada, em `tagNames`. */
  tagCount: number[]
  /** Nomes das tags, na ordem das entradas. */
  tagNames: string[]

  // ---- arquivos: uma lista única de trios ----
  /** Quantidade de arquivos de cada commit. */
  fileCount: number[]
  /** Trios [índice em `paths`, adicionadas, removidas] de todos os commits, em sequência. Binário tem -1 nas duas. */
  fileData: number[]

  // ---- árvore do HEAD ----
  treePath: string[]
  treeSize: number[]
}

/** Segundos quando todos os valores são múltiplos exatos de 1000 e a ida e volta reproduz o número; senão ms. */
function toSeconds(values: number[]): { column: number[]; seconds: boolean } {
  const seconds = values.every((t) => t % 1000 === 0 && (t / 1000) * 1000 === t)
  return seconds ? { column: values.map((t) => t / 1000), seconds: true } : { column: values, seconds: false }
}

function fromSeconds(column: number[], seconds: boolean): number[] {
  return seconds ? column.map((s) => s * 1000) : column
}

/** Converte o Analytics para o formato colunar. Não altera a entrada. */
export function encodeAnalytics(a: Analytics): AnalyticsWire {
  const { commits } = a
  const n = commits.length

  // Chave com o comprimento do nome na frente: o par (nome, e-mail) tem uma única chave, mesmo com \x1f, \x1e ou
  // qualquer outro caractere dentro do nome. Map: uma consulta por pessoa, sem varredura.
  const personIndex = new Map<string, number>()
  const peopleName: string[] = []
  const peopleEmail: string[] = []
  const intern = (name: string, email: string): number => {
    const key = `${name.length}:${name}${email}`
    let index = personIndex.get(key)
    if (index === undefined) {
      index = peopleName.length
      personIndex.set(key, index)
      peopleName.push(name)
      peopleEmail.push(email)
    }
    return index
  }

  const sha: string[] = new Array(n)
  const parents: number[] = new Array(n)
  const author: number[] = new Array(n)
  const committer: number[] = new Array(n)
  const time: number[] = new Array(n)
  const commitTime: number[] = new Array(n)
  const subject: string[] = new Array(n)
  const bodyLength: number[] = new Array(n)
  const signedOff: string[] = new Array(n)
  const coAuthors: number[] = new Array(n)
  const tagCommit: number[] = []
  const tagCount: number[] = []
  const tagNames: string[] = []
  const fileCount: number[] = new Array(n)
  const fileData: number[] = []

  for (let i = 0; i < n; i++) {
    const c: AnalyticsCommit = commits[i]
    sha[i] = c.sha
    parents[i] = c.parents
    author[i] = intern(c.author, c.email)
    committer[i] = intern(c.committer, c.committerEmail)
    time[i] = c.time
    commitTime[i] = c.commitTime
    subject[i] = c.subject
    bodyLength[i] = c.bodyLength
    signedOff[i] = c.signedOff ? '1' : '0'
    coAuthors[i] = c.coAuthors
    // Só commits com tag entram aqui: a maioria não tem, e a lista seria cheia de zeros.
    if (c.tags.length > 0) {
      tagCommit.push(i)
      tagCount.push(c.tags.length)
      for (const tag of c.tags) tagNames.push(tag)
    }
    fileCount[i] = c.files.length
    for (const [path, added, deleted] of c.files) fileData.push(path, added, deleted)
  }

  const t = toSeconds(time)
  const ct = toSeconds(commitTime)
  return {
    wire: ANALYTICS_WIRE_VERSION,
    scope: a.scope,
    truncated: a.truncated,
    generatedAt: a.generatedAt,
    paths: a.paths,
    peopleName,
    peopleEmail,
    sha,
    parents,
    author,
    committer,
    time: t.column,
    timeSec: t.seconds,
    commitTime: ct.column,
    commitTimeSec: ct.seconds,
    subject,
    bodyLength,
    signedOff: signedOff.join(''),
    coAuthors,
    tagCommit,
    tagCount,
    tagNames,
    fileCount,
    fileData,
    treePath: a.tree.map((f) => f.path),
    treeSize: a.tree.map((f) => f.size)
  }
}

/** Erro com o nome da coluna, para o diagnóstico dizer onde o formato quebrou. */
function fail(message: string): never {
  throw new Error(`analyticsWire: ${message}`)
}

function expectLength(column: string, actual: unknown[], expected: number): void {
  if (actual.length !== expected) fail(`coluna "${column}" tem ${actual.length} itens, esperado ${expected}`)
}

/** Índice inteiro dentro de [0, limit). Qualquer outra coisa é formato inconsistente. */
function checkIndex(value: number, limit: number, column: string): number {
  if (!Number.isInteger(value) || value < 0 || value >= limit) fail(`índice ${value} fora da coluna "${column}" (tamanho ${limit})`)
  return value
}

/** Volta o formato colunar para o Analytics, igual ao que o encode recebeu. Lança erro se as colunas não batem. */
export function decodeAnalytics(w: AnalyticsWire): Analytics {
  if (w.wire !== ANALYTICS_WIRE_VERSION) fail(`versão "${String(w.wire)}" não suportada`)
  const n = w.sha.length
  const people = w.peopleName.length
  if (w.peopleEmail.length !== people) fail(`coluna "peopleEmail" tem ${w.peopleEmail.length} itens, esperado ${people}`)
  const paths = w.paths.length

  expectLength('parents', w.parents, n)
  expectLength('author', w.author, n)
  expectLength('committer', w.committer, n)
  expectLength('time', w.time, n)
  expectLength('commitTime', w.commitTime, n)
  expectLength('subject', w.subject, n)
  expectLength('bodyLength', w.bodyLength, n)
  if (w.signedOff.length !== n) fail(`coluna "signedOff" tem ${w.signedOff.length} caracteres, esperado ${n}`)
  expectLength('coAuthors', w.coAuthors, n)
  expectLength('fileCount', w.fileCount, n)
  if (w.tagCount.length !== w.tagCommit.length) fail('colunas "tagCommit" e "tagCount" têm tamanhos diferentes')
  expectLength('treeSize', w.treeSize, w.treePath.length)

  // Tags: cada entrada aponta para um commit e consome `tagCount` nomes, em sequência.
  const tagsByCommit: (string[] | undefined)[] = new Array(n)
  let tagCursor = 0
  for (let k = 0; k < w.tagCommit.length; k++) {
    const commit = checkIndex(w.tagCommit[k], n, 'tagCommit')
    if (tagsByCommit[commit] !== undefined) fail(`commit ${commit} aparece duas vezes em "tagCommit"`)
    const count = w.tagCount[k]
    if (!Number.isInteger(count) || count < 0) fail(`quantidade de tags inválida em "tagCount": ${count}`)
    tagsByCommit[commit] = w.tagNames.slice(tagCursor, tagCursor + count)
    tagCursor += count
  }
  if (tagCursor !== w.tagNames.length) fail(`coluna "tagNames" tem ${w.tagNames.length} itens, as contagens pedem ${tagCursor}`)

  // Arquivos: a soma das quantidades diz quantos trios devem existir.
  let fileTotal = 0
  for (let i = 0; i < n; i++) {
    const count = w.fileCount[i]
    if (!Number.isInteger(count) || count < 0) fail(`quantidade de arquivos inválida em "fileCount": ${count}`)
    fileTotal += count
  }
  if (w.fileData.length !== fileTotal * 3) fail(`coluna "fileData" tem ${w.fileData.length} itens, esperado ${fileTotal * 3}`)

  const time = fromSeconds(w.time, w.timeSec)
  const commitTime = fromSeconds(w.commitTime, w.commitTimeSec)
  const commits: AnalyticsCommit[] = new Array(n)
  let f = 0
  for (let i = 0; i < n; i++) {
    const authorIdx = checkIndex(w.author[i], people, 'author')
    const committerIdx = checkIndex(w.committer[i], people, 'committer')
    const files: [number, number, number][] = new Array(w.fileCount[i])
    for (let j = 0; j < files.length; j++) {
      files[j] = [checkIndex(w.fileData[f], paths, 'fileData'), w.fileData[f + 1], w.fileData[f + 2]]
      f += 3
    }
    commits[i] = {
      sha: w.sha[i],
      parents: w.parents[i],
      author: w.peopleName[authorIdx],
      email: w.peopleEmail[authorIdx],
      committer: w.peopleName[committerIdx],
      committerEmail: w.peopleEmail[committerIdx],
      time: time[i],
      commitTime: commitTime[i],
      subject: w.subject[i],
      bodyLength: w.bodyLength[i],
      signedOff: w.signedOff[i] === '1',
      coAuthors: w.coAuthors[i],
      tags: tagsByCommit[i] ?? [],
      files
    }
  }

  return {
    scope: w.scope,
    commits,
    paths: w.paths,
    truncated: w.truncated,
    tree: w.treePath.map((path, i) => ({ path, size: w.treeSize[i] })),
    generatedAt: w.generatedAt
  }
}

/** Diz se o valor veio no formato colunar. Confere só o discriminante e a forma básica; o decode confere o resto. */
export function isAnalyticsWire(value: unknown): value is AnalyticsWire {
  if (value === null || typeof value !== 'object') return false
  const v = value as { wire?: unknown; sha?: unknown; peopleName?: unknown; fileData?: unknown }
  return v.wire === ANALYTICS_WIRE_VERSION && Array.isArray(v.sha) && Array.isArray(v.peopleName) && Array.isArray(v.fileData)
}
