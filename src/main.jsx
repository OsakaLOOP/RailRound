import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import RailLogApp from './RailRound.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RailLogApp />
  </StrictMode>,
)
