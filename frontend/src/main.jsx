import './polyfill.js';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import PublishedSite from './components/PublishedSite.jsx'
import { siteIdFromPath } from './lib/sitePublish.js'
import { installPuterOverlayGuard } from './lib/puterOverlayGuard.js'
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
import './styles/mobileCopilotTheme.css'
import './styles/sourceCards.css'
import './styles/polish.css'
import './mobileModelPicker.js'
import './mobileActiveModelBadges.js'
import './universalDownloads.js'

installPuterOverlayGuard()

// /s/{id}: a website published from VetroAI Computer, shown on its own.
const publishedSiteId = siteIdFromPath(window.location.pathname)

createRoot(document.getElementById('root')).render(publishedSiteId ? <PublishedSite id={publishedSiteId} /> :
  <StrictMode>
    <ErrorBoundary fallback={(error) => (
      <div role="alert" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center', background: 'var(--bg, #111)', color: 'var(--ink, #eee)' }}>
        <h2 style={{ margin: 0 }}>Something went wrong</h2>
        <p style={{ margin: 0, opacity: 0.8 }}>{error?.message || 'Unknown error'}</p>
        <button type="button" onClick={() => window.location.reload()} style={{ padding: '8px 18px', borderRadius: 8, cursor: 'pointer' }}>Reload</button>
      </div>
    )}>
      <App />
    </ErrorBoundary>
    <VoiceCoverLauncher />
    <CallAssistantLauncher />
  </StrictMode>,
)
