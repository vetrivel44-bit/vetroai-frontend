import './polyfill.js';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import VoiceCoverLauncher from './components/screens/VoiceCoverLauncher.jsx'
import './styles/mobilePalette.css'
import './styles/mobileModelPicker.css'
import './styles/modelPickerViewportFix.css'
import './styles/mobileActiveModelBadges.css'
import './styles/perplexityDarkMobile.css'
import './styles/mobileIconSpacingFix.css'
import './styles/mobileMonochromePolish.css'
import './styles/mobileComposerColorFix.css'
import './mobileModelPicker.js'
import './mobileActiveModelBadges.js'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <VoiceCoverLauncher />
  </StrictMode>,
)