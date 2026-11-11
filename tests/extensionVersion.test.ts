import { describe, expect, it } from 'vitest'
// O tsconfig.node.json não tem allowJs, então o TypeScript não tipa o .mjs (TS7016): a importação fica sem tipo.
// @ts-expect-error módulo .mjs sem declaração de tipos
import { nextExtensionVersion } from '../scripts/extension-version.mjs'

describe('nextExtensionVersion', () => {
  it('sem tags, usa a versão do arquivo', () => {
    expect(nextExtensionVersion('0.13.0', [])).toBe('0.13.0')
    expect(nextExtensionVersion('0.13.0')).toBe('0.13.0')
  })

  it('arquivo com minor acima da última tag vale como está', () => {
    expect(nextExtensionVersion('0.13.0', ['v0.11.0', 'v0.12.0'])).toBe('0.13.0')
  })

  it('arquivo com major acima da última tag vale como está', () => {
    expect(nextExtensionVersion('1.0.0', ['v0.11.0', 'v0.12.0'])).toBe('1.0.0')
  })

  it('arquivo igual à última tag vira patch + 1', () => {
    expect(nextExtensionVersion('0.12.0', ['v0.11.0', 'v0.12.0'])).toBe('0.12.1')
  })

  it('arquivo menor que a última tag vira última tag + 1', () => {
    expect(nextExtensionVersion('0.11.0', ['v0.11.0', 'v0.12.0'])).toBe('0.12.1')
    expect(nextExtensionVersion('0.5.0', ['v0.11.0', 'v0.12.0'])).toBe('0.12.1')
  })

  it('compara números por parte: v0.10.0 é maior que v0.9.0', () => {
    expect(nextExtensionVersion('0.9.0', ['v0.9.0', 'v0.10.0'])).toBe('0.10.1')
    expect(nextExtensionVersion('0.10.0', ['v0.9.0', 'v0.10.0'])).toBe('0.10.1')
    expect(nextExtensionVersion('0.10.0', ['v0.10.0', 'v0.9.0'])).toBe('0.10.1')
  })

  it('ignora tags que não são v<x>.<y>.<z>', () => {
    const tags = ['v0.11.0', 'v0.12.0', 'v0.12.0-beta', 'v0.99', 'outra', 'release-1.0.0', '0.50.0', 'v0.12.0.1']
    expect(nextExtensionVersion('0.12.0', tags)).toBe('0.12.1')
    expect(nextExtensionVersion('0.13.0', ['v0.12.0-beta', 'outra'])).toBe('0.13.0')
    expect(nextExtensionVersion('0.12.0', ['outra', 'v0.5.4'])).toBe('0.12.0')
  })

  it('versão do arquivo inválida lança erro claro', () => {
    expect(() => nextExtensionVersion('0.12', [])).toThrow(/inválida/)
    expect(() => nextExtensionVersion('v0.12.0', [])).toThrow(/inválida/)
    expect(() => nextExtensionVersion('0.12.0-beta', ['v0.11.0'])).toThrow(/inválida/)
    expect(() => nextExtensionVersion('', ['v0.11.0'])).toThrow(/inválida/)
  })
})
