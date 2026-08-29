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
      // OpenAI and Perplexity are rendered inline below so they cannot disappear
      // because of static-asset caching, MIME, CSP, or image loading issues.
      if (!next.includes('const PROVIDER_BRAND_ICONS =')) {
        const brandRenderer = `\n\nconst PROVIDER_BRAND_ICONS = {\n  [CLAUDE_FABLE_PROVIDER]: "/model-icons/claude.svg",\n  "Grok 4.6": "/model-icons/grok.svg",\n  Gemini: "/model-icons/gemini.svg",\n  Mistral: "/model-icons/mistral.svg",\n  SambaNova: "/model-icons/sambanova.svg",\n};\n\nconst ProviderBrandIcon = ({ provider, fallback }) => {\n  const isOpenAI = provider === "GPT-5.6 Sol" || provider === "GPT-5.6 Terra" || provider === "GPT-5.6 Luna" || provider === "GPT-5.3 Codex";\n\n  if (isOpenAI) {\n    return (\n      <svg width="21" height="21" viewBox="0 0 24 24" fill="#FFFFFF" aria-label="OpenAI" style={{ display: "block", flex: "none" }}>\n        <path fillRule="evenodd" d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" />\n      </svg>\n    );\n  }\n\n  if (provider === "Sonar Pro Research") {\n    return (\n      <svg width="21" height="21" viewBox="0 0 24 24" fill="#20B2AA" aria-label="Perplexity" style={{ display: "block", flex: "none" }}>\n        <path fillRule="evenodd" d="M19.785 0v7.272H22.5V17.62h-2.935V24l-7.037-6.194v6.145h-1.091v-6.152L4.392 24v-6.465H1.5V7.188h2.884V0l7.053 6.494V.19h1.09v6.49L19.786 0zm-7.257 9.044v7.319l5.946 5.234V14.44l-5.946-5.397zm-1.099-.08l-5.946 5.398v7.235l5.946-5.234V8.965zm8.136 7.58h1.844V8.349H13.46l6.105 5.54v2.655zm-8.982-8.28H2.59v8.195h1.8v-2.576l6.192-5.62zM5.475 2.476v4.71h5.115l-5.115-4.71zm13.219 0l-5.115 4.71h5.115v-4.71z" />\n      </svg>\n    );\n  }\n\n  if (provider === "Auto" || provider === "Agnes") {\n    return (\n      <span style={{ width: 18, height: 18, overflow: "hidden", display: "block" }}>\n        <img src="/logo.png" alt="VetroAI" style={{ height: 18, width: "auto", maxWidth: "none", display: "block" }} />\n      </span>\n    );\n  }\n\n  const src = PROVIDER_BRAND_ICONS[provider];\n  if (!src) return <span aria-hidden="true" style={{ color: "#fff" }}>{fallback || "✦"}</span>;\n  return (\n    <>\n      <img\n        src={src}\n        alt=""\n        width="18"\n        height="18"\n        style={{ width: 18, height: 18, objectFit: "contain", display: "block" }}\n        onError={(event) => {\n          event.currentTarget.style.display = "none";\n          const fallbackNode = event.currentTarget.nextElementSibling;\n          if (fallbackNode) fallbackNode.style.display = "block";\n        }}\n      />\n      <span aria-hidden="true" style={{ color: "#fff", display: "none", fontWeight: 800 }}>{fallback || "✦"}</span>\n    </>\n  );\n};`;

        next = next.replace(
          /(const PROVIDERS = \[[^\n]+\];)/,
          `$1${brandRenderer}`
        );
      }

      // Replace old letter badges with brand marks. The tile remains black for
      // maximum visibility; inline/local SVGs carry high-contrast provider colors.
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
