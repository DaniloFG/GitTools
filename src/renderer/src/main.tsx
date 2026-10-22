import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { DiffWindowApp, diffWindowRequest } from './components/DiffWindow'
import './styles.css'
import { installVsCodeBridge } from './vscodeBridge'

// Dentro do VS Code (webview) não há preload: a ponte com o sistema vem da extensão.
installVsCodeBridge()

// A mesma página serve a janela principal e as janelas de diff (escolhidas pela URL).
// No VS Code a URL é a do webview, então a extensão informa o pedido em __gittoolsBoot.
const diffRequest = diffWindowRequest(window.__gittoolsBoot?.search ?? window.location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>{diffRequest ? <DiffWindowApp request={diffRequest} /> : <App />}</StrictMode>
)
