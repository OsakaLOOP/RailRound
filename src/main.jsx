import React from 'react'
import ReactDOM from 'react-dom/client'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import RailRoundApp from './RailRound.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RailRoundApp />
  </StrictMode>,
)
