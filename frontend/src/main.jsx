import './polyfill.js';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import VoiceCoverLauncher from './components/screens/VoiceCoverLauncher.jsx'
import CallAssistantLauncher from './components/screens/CallAssistantLauncher.jsx'
import './styles/mobilePalette.css'
import './styles/mobileModelPicker.css'
import './styles/modelPickerViewportFix.css'
import './styles/mobileActiveModelBadges.css'
import './styles/perplexityDarkMobile.css'
import './styles/mobileIconSpacingFix.css'
import './styles/mobileMonochromePolish.css'
import './styles/mobileComposerColorFix.css'
import './styles/richOutputTools.css'
// Last in, so it settles the conflicts between the mobile layers above it.
import './styles/mobileRefresh.css'
import './mobileModelPicker.js'
import './mobileActiveModelBadges.js'
import './universalDownloads.js'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <VoiceCoverLauncher />
      <CallAssistantLauncher />
    </ErrorBoundary>
  </StrictMode>,
)
