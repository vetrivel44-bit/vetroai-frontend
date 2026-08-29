import './polyfill.js';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import VoiceCoverLauncher from './components/screens/VoiceCoverLauncher.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <VoiceCoverLauncher />
  </StrictMode>,
)