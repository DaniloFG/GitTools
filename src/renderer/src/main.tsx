import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { bootLocale, loadFallbacksLater } from './appearance'
import { diffWindowRequest } from './diffWindowRequest'
import { App } from './App'
import { DiffWindowApp } from './lazyScreens'
import './styles.css'
import { installAltTextSelection } from './textSelect'
import { installVsCodeBridge } from './vscodeBridge'

// Dentro do VS Code (webview) não há preload: a ponte com o sistema vem da extensão.
installVsCodeBridge()
// Com Alt pressionado, o texto das linhas arrastáveis pode ser selecionado (vale para o app, o webview e as janelas de diff).
installAltTextSelection()

// A mesma página serve a janela principal e as janelas de diff (escolhidas pela URL).
// No VS Code a URL é a do webview, então a extensão informa o pedido em __gittoolsBoot.
const diffRequest = diffWindowRequest(window.__gittoolsBoot?.search ?? window.location.search)

// Os catálogos de idioma vêm sob demanda: o primeiro desenho espera o do idioma ativo (uma leitura das
// configurações e um pedaço do pacote), para a tela não aparecer com chaves cruas nem trocar de idioma em seguida.
void bootLocale().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>{diffRequest ? <Suspense fallback={null}><DiffWindowApp request={diffRequest} /></Suspense> : <App />}</StrictMode>
  )
  loadFallbacksLater()
})
