// Chess Arena on its own page, /chess (chess.html).
//
// This page is served cross-origin isolated (COOP same-origin plus COEP
// credentialless, see public/_headers). That is what gives Master's Stockfish
// SharedArrayBuffer, and with it several threads. The rest of VetroAI can't be
// isolated: it signs in through popups (Google, Puter), and an isolated page
// never hears back from a popup on another origin. So the arena runs here,
// without the app's sign-in or Puter scripts, and the sidebar links to it.
import "./polyfill.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./App.css";
// The stylesheets main.jsx loads after the app, in the same order, so the
// arena looks exactly as it does inside VetroAI.
import "./styles/mobilePalette.css";
import "./styles/mobileModelPicker.css";
import "./styles/modelPickerViewportFix.css";
import "./styles/mobileActiveModelBadges.css";
import "./styles/perplexityDarkMobile.css";
import "./styles/mobileIconSpacingFix.css";
import "./styles/mobileMonochromePolish.css";
import "./styles/mobileComposerColorFix.css";
import "./styles/richOutputTools.css";
import "./styles/mobileCopilotTheme.css";
import "./styles/sourceCards.css";
import "./styles/polish.css";
import "./styles/codeCards.css";
import ChessArena from "./components/screens/ChessArena.jsx";

// Signed out: the app shows its sign-in screen.
if (!localStorage.getItem("token")) {
  window.location.replace("/");
} else {
  document.documentElement.setAttribute("data-theme", localStorage.getItem("vetroai_theme") || "dark");
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <div style={{ position: "fixed", inset: 0, display: "flex", background: "var(--bg)" }}>
        <ChessArena onClose={() => window.location.assign("/")} />
      </div>
    </StrictMode>,
  );
}
