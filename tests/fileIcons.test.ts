import { describe, expect, it } from 'vitest'
import { ensureIconSymbol, folderIconName, folderIconSvg, iconNameFor, iconSvg, symbolMarkup } from '../src/renderer/src/fileIcons'
import { FILE_ICON_DEFAULT, FILE_ICON_SVGS } from '../src/renderer/src/fileIcons.generated'

describe('ícones de arquivo', () => {
  it('escolhe pelo nome do arquivo e pela extensão', () => {
    expect(iconNameFor('src/app.ts')).toBe('typescript')
    expect(iconNameFor('src/App.tsx')).toBe('react_ts')
    expect(iconNameFor('package.json')).toBe('nodejs')
    expect(iconNameFor('docs/README.md')).toBe('readme')
    expect(iconNameFor('Dockerfile')).toBe('docker')
    expect(iconNameFor('.gitignore')).toBe('git')
    expect(iconNameFor('estilo.CSS')).toBe('css')
  })

  it('usa o sufixo mais específico (test.ts antes de ts)', () => {
    expect(iconNameFor('tests/a.test.ts')).toBe('test-ts')
    expect(iconNameFor('types/index.d.ts')).toBe('typescript-def')
  })

  it('tipo desconhecido ou sem extensão: ícone de arquivo comum', () => {
    expect(iconNameFor('coisa.xyzabc')).toBe('file')
    expect(iconNameFor('LEIAME')).toBe('file')
  })

  it('entrega SVGs válidos para arquivos e pastas', () => {
    for (const name of ['typescript', 'file', iconNameFor('a.py')]) expect(iconSvg(name)).toMatch(/^<svg[\s\S]*<\/svg>$/)
    expect(folderIconSvg(false)).toMatch(/^<svg/)
    expect(folderIconSvg(true)).toMatch(/^<svg/)
    expect(folderIconSvg(true)).not.toBe(folderIconSvg(false))
  })

  it('o tema claro pode ter uma variante própria, e cai no ícone normal quando não tem', () => {
    expect(iconNameFor('a.ts', true)).toBe('typescript')
    expect(iconSvg(iconNameFor('a.md', true))).toMatch(/^<svg/)
  })

  describe('sprite de símbolos', () => {
    it('ícone comum vira <symbol> com o viewBox da raiz e sem o <svg>', () => {
      const out = symbolMarkup('android', FILE_ICON_SVGS.android)
      expect(out.startsWith('<symbol id="fi-android" viewBox="0 0 32 32">')).toBe(true)
      expect(out.endsWith('</symbol>')).toBe(true)
      expect(out).not.toMatch(/<svg/)
      expect(out).not.toMatch(/xmlns/)
    })

    it('atributos extras da raiz (fill) vão para um <g> em volta do conteúdo', () => {
      const out = symbolMarkup('changelog', FILE_ICON_SVGS.changelog)
      expect(out).toMatch(/^<symbol id="fi-changelog" viewBox="0 0 24 24"><g fill="none">[\s\S]*<\/g><\/symbol>$/)
      expect(out).not.toMatch(/xmlns|<svg/)
    })

    it('raiz sem atributos extras não ganha <g>', () => {
      expect(symbolMarkup('android', FILE_ICON_SVGS.android)).not.toMatch(/<g /)
    })

    it('ids internos ganham o prefixo do ícone (jenkins, kotlin e maven usam id="a")', () => {
      for (const name of ['jenkins', 'kotlin', 'maven']) {
        const out = symbolMarkup(name, FILE_ICON_SVGS[name])
        expect(out).toContain(`id="fi-${name}-a"`)
        expect(out).toContain(`url(#fi-${name}-a)`)
        expect(out).not.toContain('url(#a)')
        expect(out).not.toContain('id="a"')
      }
    })

    it('href="#X" e xlink:href também são reescritos', () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><defs><path id="p" d="M0 0"/></defs><use href="#p"/><use xlink:href="#p"/></svg>'
      const out = symbolMarkup('x', svg)
      expect(out).toContain('id="fi-x-p"')
      expect(out).toContain('href="#fi-x-p"')
      expect(out).toContain('xlink:href="#fi-x-p"')
    })

    it('todo ícone da tabela gera um único <symbol>, com viewBox, e ids únicos no conjunto', () => {
      const names = Object.keys(FILE_ICON_SVGS)
      const ids: string[] = []
      names.forEach((name) => {
        const out = symbolMarkup(name, FILE_ICON_SVGS[name])
        expect(out.match(/<symbol\b/g)).toHaveLength(1)
        expect(out).toMatch(/<symbol [^>]*viewBox="[^"]+"/)
        expect(out).toContain(`id="fi-${name}"`)
        for (const m of out.matchAll(/\sid="([^"]+)"/g)) ids.push(m[1])
      })
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('ensureIconSymbol devolve o id em Node (sem documento) e cai no ícone padrão', () => {
      expect('document' in globalThis).toBe(false)
      expect(ensureIconSymbol('typescript')).toBe('fi-typescript')
      expect(ensureIconSymbol('nao-existe')).toBe(`fi-${FILE_ICON_DEFAULT}`)
      expect(folderIconName(true)).toBe('folder-open')
      expect(folderIconName(false)).toBe('folder')
    })
  })
})
