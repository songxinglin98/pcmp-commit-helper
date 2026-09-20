import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { bridge } from './bridge'
import type { HostToWebview } from '@shared/protocol'
import './index.css'

window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
  bridge.dispatch(event.data)
})

const container = document.getElementById('root')
if (!container) throw new Error('#root 不存在')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
