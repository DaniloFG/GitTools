import { describe, expect, it } from 'vitest'
import { buildPartialPatch, changeKeys, parseDiff, quotePath, trimTruncated, unquotePath } from '../src/core/diff'
import { splitRows } from '../src/shared/diffKeys'

const SAMPLE = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,5 @@ function main
 line 1
-line 2
+line two
+line 2.5
 line 3
 line 4
@@ -10,3 +11,2 @@
 line 10
-line 11
 line 12
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
\\ No newline at end of file
diff --git a/img.png b/img.png
index 4444444..5555555 100644
Binary files a/img.png and b/img.png differ
diff --git a/old name.txt b/new name.txt
similarity index 100%
rename from old name.txt
rename to new name.txt
`

describe('parseDiff', () => {
  const files = parseDiff(SAMPLE)

  it('lê todos os arquivos e tipos de alteração', () => {
    expect(files.map((f) => [f.path, f.changeType, f.binary])).toEqual([
      ['src/app.ts', 'modified', false],
      ['new.txt', 'added', false],
      ['img.png', 'modified', true],
      ['new name.txt', 'renamed', false]
    ])
    expect(files[3].oldPath).toBe('old name.txt')
  })

  it('numera as linhas e conta adições/remoções', () => {
    const [app] = files
    expect(app.additions).toBe(2)
    expect(app.deletions).toBe(2)
    expect(app.hunks[0].section).toBe('function main')
    expect(app.hunks[0].lines[2]).toMatchObject({ kind: 'add', content: 'line two', newLine: 2, oldLine: null })
    expect(app.hunks[1].lines[1]).toMatchObject({ kind: 'del', content: 'line 11', oldLine: 11 })
  })

  it('marca linhas sem quebra de linha final', () => {
    expect(files[1].hunks[0].lines[1].noNewline).toBe(true)
  })
})

describe('buildPartialPatch', () => {
  const [app, added] = parseDiff(SAMPLE)

  it('com tudo selecionado reproduz o patch original', () => {
    const patch = buildPartialPatch(app, 'all')!
    expect(patch).toBe(SAMPLE.slice(0, SAMPLE.indexOf('diff --git a/new.txt')))
  })

  it('linhas adicionadas não selecionadas somem e removidas viram contexto', () => {
    // Seleciona apenas "+line two" (hunk 0, linha 2).
    const patch = buildPartialPatch(app, ['0:2'])!
    expect(patch).toContain('@@ -1,4 +1,5 @@ function main\n line 1\n line 2\n+line two\n line 3\n line 4\n')
    expect(patch).not.toContain('line 2.5')
    expect(patch).not.toContain('@@ -10')
  })

  it('ajusta o início dos hunks seguintes', () => {
    const patch = buildPartialPatch(app, ['0:1', '1:1'])!
    expect(patch).toContain('@@ -1,4 +1,3 @@')
    expect(patch).toContain('@@ -10,3 +9,2 @@')
  })

  it('no modo reverso inverte o tratamento das linhas não selecionadas', () => {
    const patch = buildPartialPatch(app, ['0:3'], true)!
    expect(patch).toContain('@@ -1,4 +1,5 @@ function main\n line 1\n line two\n+line 2.5\n line 3\n line 4\n')
  })

  it('mantém o marcador de "sem quebra de linha"', () => {
    const patch = buildPartialPatch(added, 'all')!
    expect(patch.endsWith('+world\n\\ No newline at end of file\n')).toBe(true)
  })

  it('retorna null sem seleção', () => {
    expect(buildPartialPatch(app, [])).toBeNull()
    expect(changeKeys(app)).toHaveLength(4)
  })
})

describe('quotePath/unquotePath', () => {
  it('são inversas', () => {
    for (const p of ['simples.txt', 'com espaço.txt', 'aspas"aqui', 'barra\\invertida', 'acentuação.md', 'tab\there']) {
      expect(unquotePath(quotePath(p))).toBe(p)
    }
    expect(unquotePath('"\\303\\241.txt"')).toBe('á.txt')
  })
})

describe('splitRows (diff lado a lado)', () => {
  const line = (kind: 'context' | 'add' | 'del') => ({ kind, content: kind, oldLine: null, newLine: null })
  const hunk = (kinds: ('context' | 'add' | 'del')[]) => ({ oldStart: 1, oldCount: 0, newStart: 1, newCount: 0, section: '', lines: kinds.map(line) })

  it('emparelha remoções com as adições seguintes e repete o contexto dos dois lados', () => {
    expect(splitRows(hunk(['context', 'del', 'del', 'add', 'context']))).toEqual([
      { left: 0, right: 0 },
      { left: 1, right: 3 },
      { left: 2, right: null },
      { left: 4, right: 4 }
    ])
  })

  it('deixa o outro lado vazio quando só há adições ou só remoções', () => {
    expect(splitRows(hunk(['add', 'add']))).toEqual([
      { left: null, right: 0 },
      { left: null, right: 1 }
    ])
    expect(splitRows(hunk(['del', 'add', 'del']))).toEqual([
      { left: 0, right: 1 },
      { left: 2, right: null }
    ])
  })
})

describe('trimTruncated (diff cortado no teto)', () => {
  const TWO_FILES = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1,1 +1,1 @@
-x
+y
diff --git a/b.txt b/b.txt
--- a/b.txt
+++ b/b.txt
@@ -1,2 +1,3 @@
 keep
-old1
+new1
@@ -10,1 +11,2 @@
-old2
+new2
+new3
`

  it('tira só o último bloco do último arquivo e refaz as contagens dele', () => {
    const [first, last] = trimTruncated(parseDiff(TWO_FILES))
    expect(first.path).toBe('a.txt')
    expect(first.truncated).toBeUndefined()
    expect(first.hunks).toHaveLength(1)
    expect(last.path).toBe('b.txt')
    expect(last.truncated).toBe(true)
    expect(last.hunks).toHaveLength(1)
    expect(last.hunks[0].lines.map((l) => l.content)).toEqual(['keep', 'old1', 'new1'])
    expect(last.additions).toBe(1)
    expect(last.deletions).toBe(1)
  })

  it('arquivo com um bloco só fica sem blocos e marcado como cortado', () => {
    const [file] = trimTruncated(parseDiff(TWO_FILES.split('diff --git a/b.txt')[0]))
    expect(file.path).toBe('a.txt')
    expect(file.truncated).toBe(true)
    expect(file.hunks).toHaveLength(0)
    expect(file.additions).toBe(0)
    expect(file.deletions).toBe(0)
  })

  it('arquivo cortado no cabeçalho (sem blocos) sai e o anterior fica marcado', () => {
    const files = trimTruncated(parseDiff(TWO_FILES + 'diff --git a/c.txt b/c.t'))
    expect(files.map((f) => f.path)).toEqual(['a.txt', 'b.txt'])
    expect(files[0].truncated).toBeUndefined()
    // O arquivo anterior veio inteiro: não perde bloco nenhum, só fica marcado como cortado no fim.
    expect(files[1].truncated).toBe(true)
    expect(files[1].hunks).toHaveLength(2)
  })

  it('lista vazia devolve lista vazia', () => {
    expect(trimTruncated([])).toEqual([])
  })
})
