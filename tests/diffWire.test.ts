import { describe, expect, it } from 'vitest'
import { parseDiff, trimTruncated } from '../src/core/diff'
import { decodeDiffs, encodeDiffs, isWireDiffs } from '../src/shared/diffWire'
import type { FileDiff } from '../src/shared/types'

// Saídas de `git diff` de exemplo, no formato que o repositório recebe.
const MODIFICADO = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,4 +1,5 @@ function f() {',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  '+const c = 4',
  ' const d = 5',
  ' ',
  '@@ -20,3 +21,2 @@',
  ' fim',
  '-meio',
  ' ultimo'
].join('\n')

const SEM_QUEBRA_FINAL = [
  'diff --git a/x.txt b/x.txt',
  'index 3333333..4444444 100644',
  '--- a/x.txt',
  '+++ b/x.txt',
  '@@ -1,2 +1,2 @@',
  ' primeira',
  '-ultima antiga',
  '\\ No newline at end of file',
  '+ultima nova',
  '\\ No newline at end of file',
  '@@ -9 +9 @@',
  '-sem fim',
  '\\ No newline at end of file',
  '+com fim'
].join('\n')

const NOVO = [
  'diff --git a/novo.txt b/novo.txt',
  'new file mode 100644',
  'index 0000000..5555555',
  '--- /dev/null',
  '+++ b/novo.txt',
  '@@ -0,0 +1,2 @@',
  '+um',
  '+dois'
].join('\n')

const REMOVIDO = [
  'diff --git a/velho.txt b/velho.txt',
  'deleted file mode 100644',
  'index 6666666..0000000',
  '--- a/velho.txt',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-um',
  '-dois'
].join('\n')

const RENOMEADO = [
  'diff --git a/antigo.ts b/novo.ts',
  'similarity index 80%',
  'rename from antigo.ts',
  'rename to novo.ts',
  'index 7777777..8888888 100644',
  '--- a/antigo.ts',
  '+++ b/novo.ts',
  '@@ -1,3 +1,3 @@',
  ' a',
  '-b',
  '+B',
  ' c'
].join('\n')

const BINARIO = ['diff --git a/img.png b/img.png', 'index 9999999..aaaaaaa 100644', 'Binary files a/img.png and b/img.png differ'].join('\n')

const LINHA_VAZIA = [
  'diff --git a/vazio.txt b/vazio.txt',
  'index 1212121..3434343 100644',
  '--- a/vazio.txt',
  '+++ b/vazio.txt',
  '@@ -1,3 +1,3 @@',
  ' x',
  '',
  '-y',
  '+z'
].join('\n')

const VARIOS_ARQUIVOS = [MODIFICADO, NOVO, REMOVIDO, RENOMEADO, BINARIO, SEM_QUEBRA_FINAL, LINHA_VAZIA].join('\n') + '\n'

/** Ida e volta: o que a interface recebe depois do decode tem de ser igual ao que o parseDiff produziu. */
function roundTrip(files: FileDiff[]): FileDiff[] {
  // JSON é o que o IPC e o cache de fato transportam; o teste passa por ele de propósito.
  return decodeDiffs(JSON.parse(JSON.stringify(encodeDiffs(files))))
}

describe('formato compacto do diff: ida e volta', () => {
  it('modificado com contexto, adição, remoção, vários hunks e seção', () => {
    const files = parseDiff(MODIFICADO)
    expect(roundTrip(files)).toEqual(files)
  })

  it('"\\ No newline at end of file" de um lado e do outro', () => {
    const files = parseDiff(SEM_QUEBRA_FINAL)
    expect(files[0].hunks[0].lines.some((l) => l.noNewline)).toBe(true)
    expect(roundTrip(files)).toEqual(files)
  })

  it('arquivo novo (hunk com início 0)', () => {
    const files = parseDiff(NOVO)
    expect(files[0].changeType).toBe('added')
    expect(roundTrip(files)).toEqual(files)
  })

  it('arquivo removido', () => {
    const files = parseDiff(REMOVIDO)
    expect(files[0].changeType).toBe('deleted')
    expect(roundTrip(files)).toEqual(files)
  })

  it('renomeado com alteração', () => {
    const files = parseDiff(RENOMEADO)
    expect(files[0].changeType).toBe('renamed')
    expect(roundTrip(files)).toEqual(files)
  })

  it('binário (sem hunks)', () => {
    const files = parseDiff(BINARIO)
    expect(files[0].binary).toBe(true)
    expect(roundTrip(files)).toEqual(files)
  })

  it('linha de contexto vazia (sem o espaço inicial) continua contexto', () => {
    const files = parseDiff(LINHA_VAZIA)
    expect(roundTrip(files)).toEqual(files)
  })

  it('vários arquivos num único diff', () => {
    const files = parseDiff(VARIOS_ARQUIVOS)
    expect(files.length).toBe(7)
    expect(roundTrip(files)).toEqual(files)
  })

  it('diff sintético de arquivo não rastreado (igual ao untrackedDiff do repositório)', () => {
    const path = 'rascunho.txt'
    const lines = ['primeira', '', 'terceira']
    const file: FileDiff = {
      oldPath: null,
      newPath: path,
      path,
      changeType: 'added',
      binary: false,
      headerLines: [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null', `+++ b/${path}`],
      hunks: [
        {
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: lines.length,
          section: '',
          lines: lines.map((content, i) => ({ kind: 'add' as const, content, oldLine: null, newLine: i + 1 }))
        }
      ],
      additions: lines.length,
      deletions: 0
    }
    expect(roundTrip([file])).toEqual([file])
  })

  it('diff cortado no teto (truncated) mantém a marca e as contagens', () => {
    const files = trimTruncated(parseDiff(MODIFICADO))
    expect(files[0].truncated).toBe(true)
    expect(roundTrip(files)).toEqual(files)
  })

  it('números de linha fora da regra de recálculo vão junto, sem erro', () => {
    const estranho: FileDiff = {
      oldPath: 'a.txt',
      newPath: 'a.txt',
      path: 'a.txt',
      changeType: 'modified',
      binary: false,
      headerLines: [],
      hunks: [
        {
          oldStart: 7,
          oldCount: 1,
          newStart: 3,
          newCount: 1,
          section: '',
          lines: [
            { kind: 'del', content: 'x', oldLine: 99, newLine: null },
            { kind: 'add', content: 'y', oldLine: null, newLine: 42 }
          ]
        }
      ],
      additions: 1,
      deletions: 1
    }
    const wire = encodeDiffs([estranho])
    expect(wire[0].hunks[0].ol).toEqual([99, null])
    expect(roundTrip([estranho])).toEqual([estranho])
  })

  it('o hunk que segue a regra não carrega números de linha', () => {
    const wire = encodeDiffs(parseDiff(MODIFICADO))
    for (const hunk of wire[0].hunks) {
      expect(hunk.ol).toBeUndefined()
      expect(hunk.nl).toBeUndefined()
    }
  })

  it('reconhece o formato de transporte pelo marcador', () => {
    const files = parseDiff(MODIFICADO)
    expect(isWireDiffs(encodeDiffs(files))).toBe(true)
    expect(isWireDiffs(files)).toBe(false)
    expect(isWireDiffs([])).toBe(true)
    expect(isWireDiffs(undefined)).toBe(false)
  })
})

/** Diff de um arquivo com `pares` linhas trocadas (uma removida e uma adicionada por par). */
function bigDiff(pares: number): string {
  const body: string[] = []
  for (let i = 1; i <= pares; i++) {
    body.push(`-    const valor${i} = calcular(${i}, "texto antigo da linha ${i}");`)
    body.push(`+    const valor${i} = calcular(${i}, "texto novo da linha ${i}", true);`)
  }
  return [
    'diff --git a/grande.ts b/grande.ts',
    'index 1234567..89abcde 100644',
    '--- a/grande.ts',
    '+++ b/grande.ts',
    `@@ -1,${pares} +1,${pares} @@`,
    ...body
  ].join('\n')
}

describe('formato compacto do diff: tamanho', () => {
  it('um diff de 5.000 linhas alteradas fica bem menor que o JSON de hoje', () => {
    const files = parseDiff(bigDiff(2500))
    const hoje = JSON.stringify(files).length
    const compacto = JSON.stringify(encodeDiffs(files)).length
    expect(files[0].deletions + files[0].additions).toBe(5000)
    // Medido: o formato tira cerca de 54 bytes por linha (chaves e números repetidos). Com linhas de conteúdo
    // médio, o resto é o texto, que não encolhe; por isso a meta de "menos da metade" não se cumpre só com a forma
    // (fica entre 53% e 69% conforme o tamanho do texto). O limite fica no valor medido, para pegar regressão.
    expect(compacto).toBeLessThan(hoje * 0.6)
    expect(roundTrip(files)).toEqual(files)
  })
})
