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

      // Bundle provider marks with VetroAI itself instead of hotlinking CDNs.
      // This prevents CSP/network failures from leaving empty black icon tiles.
      if (!next.includes('const PROVIDER_BRAND_ICONS =')) {
        const brandRenderer = `\n\nconst PROVIDER_BRAND_ICONS = {\n  "GPT-5.6 Sol": "/model-icons/openai.svg",\n  "GPT-5.6 Terra": "/model-icons/openai.svg",\n  "GPT-5.6 Luna": "/model-icons/openai.svg",\n  "GPT-5.3 Codex": "/model-icons/openai.svg",\n  [CLAUDE_FABLE_PROVIDER]: "/model-icons/claude.svg",\n  "Grok 4.6": "/model-icons/grok.svg",\n  "Sonar Pro Research": "/model-icons/perplexity.svg",\n  Gemini: "/model-icons/gemini.svg",\n  Mistral: "/model-icons/mistral.svg",\n  SambaNova: "/model-icons/sambanova.svg",\n};\n\nconst ProviderBrandIcon = ({ provider, fallback }) => {\n  if (provider === "Auto" || provider === "Agnes") {\n    return (\n      <span style={{ width: 18, height: 18, overflow: "hidden", display: "block" }}>\n        <img src="/logo.png" alt="VetroAI" style={{ height: 18, width: "auto", maxWidth: "none", display: "block" }} />\n      </span>\n    );\n  }\n\n  const src = PROVIDER_BRAND_ICONS[provider];\n  if (!src) return <span aria-hidden="true" style={{ color: "#fff" }}>{fallback || "✦"}</span>;\n  return (\n    <>\n      <img\n        src={src}\n        alt=""\n        width="18"\n        height="18"\n        style={{ width: 18, height: 18, objectFit: "contain", display: "block" }}\n        onError={(event) => {\n          event.currentTarget.style.display = "none";\n          const fallbackNode = event.currentTarget.nextElementSibling;\n          if (fallbackNode) fallbackNode.style.display = "block";\n        }}\n      />\n      <span aria-hidden="true" style={{ color: "#fff", display: "none", fontWeight: 800 }}>{fallback || "✦"}</span>\n    </>\n  );\n};`;

        next = next.replace(
          /(const PROVIDERS = \[[^\n]+\];)/,
          `$1${brandRenderer}`
        );
      }

      // Replace old letter badges with brand marks. The tile remains black for
      // maximum visibility; local SVGs carry high-contrast provider colors.
      next = next.replace(
        '<span className={`ws-model-mark model-${provider.toLowerCase().replace(/\\s+/g, "-")}`}>{mark}</span>',
        '<span className={`ws-model-mark model-${provider.toLowerCase().replace(/\\s+/g, "-")}`} style={{ background: "#09090b", color: "#fff", border: "1px solid rgba(255,255,255,.16)", boxShadow: "0 2px 5px rgba(0,0,0,.22)" }}><ProviderBrandIcon provider={provider} fallback={mark} /></span>'
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
