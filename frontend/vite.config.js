import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

function browserPuterModelsTransform() {
  return {
    name: 'vetroai-browser-puter-models',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/App.jsx')) return null;

      let next = code;

      // Remove the obsolete frontend Groq key reference. Grok 4.6 and Sonar Pro
      // are accessed browser-side through Puter and need no developer API key.
      next = next.replace(
        /^const VITE_GROQ_KEY = import\.meta\.env\.VITE_GROQ_API_KEY \|\| "";\s*$/m,
        ''
      );

      // Add Grok to the same Puter model map used by Claude/OpenAI browser-side
      // models. This makes the normal model selector call puter.ai.chat directly.
      if (!next.includes('"Grok 4.6": "x-ai/grok-4.6"')) {
        next = next.replace(
          /("GPT-5\.3 Codex"\s*:\s*"openai\/gpt-5\.3-codex",?)/,
          '$1\n  "Grok 4.6": "x-ai/grok-4.6",'
        );
      }

      // Sonar Pro can also be selected explicitly. Deep Search / Research modes
      // are routed to this same model automatically by research-puter-bridge.js.
      if (!next.includes('"Sonar Pro Research": "perplexity/sonar-pro"')) {
        const grokLine = /("Grok 4\.6"\s*:\s*"x-ai\/grok-4\.6",?)/;
        if (grokLine.test(next)) {
          next = next.replace(grokLine, '$1\n  "Sonar Pro Research": "perplexity/sonar-pro",');
        } else {
          next = next.replace(
            /("GPT-5\.3 Codex"\s*:\s*"openai\/gpt-5\.3-codex",?)/,
            '$1\n  "Sonar Pro Research": "perplexity/sonar-pro",'
          );
        }
      }

      // Rename all user-visible provider strings while preserving lowercase
      // internal `groq` IDs used by Multi-AI compatibility routing.
      next = next.replace(/"Groq"/g, '"Grok 4.6"');
      next = next.replace(
        /\bGroq\s*:\s*\["Q",\s*"Fast responses"\]/g,
        '"Grok 4.6": ["G", "xAI Grok 4.6 · Puter"]'
      );

      // Make Sonar Pro a real item in the visible provider grid too.
      next = next.replace(
        /"Grok 4\.6",\s*"Gemini"/,
        '"Grok 4.6", "Sonar Pro Research", "Gemini"'
      );
      if (!next.includes('"Sonar Pro Research": ["P", "Perplexity · live research"]')) {
        next = next.replace(
          /("Grok 4\.6":\s*\["G",\s*"xAI Grok 4\.6 · Puter"\],)/,
          '$1\n    "Sonar Pro Research": ["P", "Perplexity · live research"],'
        );
      }

      // Inject one reusable brand-icon renderer. Common providers use their
      // recognizable marks; Auto/Agnes use the VetroAI mark; SambaNova gets a
      // clean non-letter waveform fallback rather than another initial badge.
      if (!next.includes('const PROVIDER_BRAND_ICONS =')) {
        const brandRenderer = `\n\nconst PROVIDER_BRAND_ICONS = {\n  "GPT-5.6 Sol": "https://cdn.simpleicons.org/openai/FFFFFF",\n  "GPT-5.6 Terra": "https://cdn.simpleicons.org/openai/FFFFFF",\n  "GPT-5.6 Luna": "https://cdn.simpleicons.org/openai/FFFFFF",\n  "GPT-5.3 Codex": "https://cdn.simpleicons.org/openai/FFFFFF",\n  [CLAUDE_FABLE_PROVIDER]: "https://cdn.simpleicons.org/anthropic/D97757",\n  "Grok 4.6": "https://cdn.simpleicons.org/x/FFFFFF",\n  "Sonar Pro Research": "https://cdn.simpleicons.org/perplexity/20B2AA",\n  Gemini: "https://cdn.simpleicons.org/googlegemini/8E75B2",\n  Mistral: "https://cdn.simpleicons.org/mistralai/FF7000",\n};\n\nconst ProviderBrandIcon = ({ provider, fallback }) => {\n  if (provider === "Auto" || provider === "Agnes") {\n    return (\n      <span style={{ width: 18, height: 18, overflow: "hidden", display: "block" }}>\n        <img src="/logo.png" alt="VetroAI" style={{ height: 18, width: "auto", maxWidth: "none", display: "block" }} />\n      </span>\n    );\n  }\n\n  if (provider === "SambaNova") {\n    return (\n      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-label="SambaNova">\n        <path d="M2.5 5.2C5.1 2.6 7.7 2.6 10.3 5.2C12.1 7 13.9 7 15.5 5.4" stroke="#A78BFA" strokeWidth="1.8" strokeLinecap="round"/>\n        <path d="M2.5 9C5.1 6.4 7.7 6.4 10.3 9C12.1 10.8 13.9 10.8 15.5 9.2" stroke="#A78BFA" strokeWidth="1.8" strokeLinecap="round"/>\n        <path d="M2.5 12.8C5.1 10.2 7.7 10.2 10.3 12.8C12.1 14.6 13.9 14.6 15.5 13" stroke="#A78BFA" strokeWidth="1.8" strokeLinecap="round"/>\n      </svg>\n    );\n  }\n\n  const src = PROVIDER_BRAND_ICONS[provider];\n  if (!src) return <span aria-hidden="true" style={{ color: "#fff" }}>{fallback || "✦"}</span>;\n  return (\n    <img\n      src={src}\n      alt=""\n      width="18"\n      height="18"\n      loading="lazy"\n      style={{ width: 18, height: 18, objectFit: "contain", display: "block" }}\n      onError={(event) => { event.currentTarget.style.display = "none"; }}\n    />\n  );\n};`;

        next = next.replace(
          /(const PROVIDERS = \[[^\n]+\];)/,
          `$1${brandRenderer}`
        );
      }

      // Replace the old first-letter mark in the workspace model selector.
      // Keep the icon tile black so every provider mark has strong contrast.
      next = next.replace(
        '<span className={`ws-model-mark model-${provider.toLowerCase().replace(/\\s+/g, "-")}`}>{mark}</span>',
        '<span className={`ws-model-mark model-${provider.toLowerCase().replace(/\\s+/g, "-")}`} style={{ background: "#09090b", color: "#fff", border: "1px solid rgba(255,255,255,.14)", boxShadow: "0 2px 5px rgba(0,0,0,.22)" }}><ProviderBrandIcon provider={provider} fallback={mark} /></span>'
      );

      return { code: next, map: null };
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [browserPuterModelsTransform(), react()],
    server: {
      port: Number(env.VITE_PORT) || 5173,
      strictPort: true,
      host: true,
      cors: {
        origin: '*',
        methods: '*',
        headers: '*'
      },
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
        "Access-Control-Allow-Origin": "*"
      },
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
          secure: false,
        }
      }
    },
    optimizeDeps: {
      include: ['leaflet', 'react-leaflet']
    }
  }
})
