import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { DiffWindowApp, diffWindowRequest } from './components/DiffWindow'
import './styles.css'

// A mesma página serve a janela principal e as janelas de diff (escolhidas pela URL).
const diffRequest = diffWindowRequest(window.location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>{diffRequest ? <DiffWindowApp request={diffRequest} /> : <App />}</StrictMode>
)
