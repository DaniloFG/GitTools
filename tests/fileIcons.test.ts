import { describe, expect, it } from 'vitest'
import { folderIconSvg, iconNameFor, iconSvg } from '../src/renderer/src/fileIcons'

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
})
