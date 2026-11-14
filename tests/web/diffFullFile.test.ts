import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AppSettingsContext, type AppSettingsValue } from '../../src/renderer/src/context'
import { useFullFile, useFullFileOf } from '../../src/renderer/src/components/DiffView'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'

// O desenho de servidor não tem `getServerSnapshot`; a escolha temporária (layout) não é o que se testa aqui.
vi.mock('../../src/renderer/src/layout', async (original) => ({ ...(await original<object>()), useLayout: () => [undefined, () => {}] }))

/** Roda o hook num desenho de servidor e devolve o que ele leu. */
function leitura(hook: () => boolean, envolver?: (filho: ReactNode) => ReactNode): boolean {
  let lido: boolean | undefined
  const Sonda = () => {
    lido = hook()
    return null
  }
  const filho = createElement(Sonda)
  renderToStaticMarkup(createElement('div', null, envolver ? envolver(filho) : filho))
  return lido as boolean
}

const comConfiguracao = (diffFullFile: boolean) => (filho: ReactNode) =>
  createElement(AppSettingsContext.Provider, { value: { settings: { ...DEFAULT_SETTINGS, diffFullFile } } as AppSettingsValue }, filho)

describe('arquivo inteiro no diff (#162)', () => {
  it('useFullFile lê a configuração salva do provider acima dele', () => {
    expect(leitura(() => useFullFile()[0], comConfiguracao(true))).toBe(true)
    expect(leitura(() => useFullFile()[0], comConfiguracao(false))).toBe(false)
  })

  it('useFullFileOf usa a configuração dada, mesmo sem provider acima (a janela de diff cria o provider abaixo do hook)', () => {
    expect(leitura(() => useFullFile()[0])).toBe(false)
    expect(leitura(() => useFullFileOf(true)[0])).toBe(true)
    expect(leitura(() => useFullFileOf(false)[0])).toBe(false)
  })
})
