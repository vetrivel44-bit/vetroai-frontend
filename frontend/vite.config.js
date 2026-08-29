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
      next = next.replace(/^const VITE_GROQ_KEY = import\.meta\.env\.VITE_GROQ_API_KEY \|\| "";\s*$/m, '');

      const addModelAfterCodex = (label, model) => {
        if (!next.includes(`"${label}": "${model}"`)) {
          next = next.replace(/("GPT-5\.3 Codex"\s*:\s*"openai\/gpt-5\.3-codex",?)/, `$1\n  "${label}": "${model}",`);
        }
      };
      addModelAfterCodex('Grok 4.6', 'x-ai/grok-4.6');
      addModelAfterCodex('Gemini 3.1 Pro', 'gemini-3.1-pro-preview');
      addModelAfterCodex('Gemini 3.7 Flash', 'gemini-3.7-flash');
      addModelAfterCodex('Gemini 3.5 Flash-Lite', 'gemini-3.5-flash-lite');
      addModelAfterCodex('Claude Sonnet 5', 'claude-sonnet-5');
      addModelAfterCodex('Claude Haiku 4.5', 'claude-haiku-4-5');
      addModelAfterCodex('Claude Opus 5', 'claude-opus-5');
      addModelAfterCodex('Claude Opus 5 Fast', 'claude-opus-5-fast');

      if (!next.includes('"Sonar Pro Research": "perplexity/sonar-pro"')) {
        next = next.replace(/("Grok 4\.6"\s*:\s*"x-ai\/grok-4\.6",?)/, '$1\n  "Sonar Pro Research": "perplexity/sonar-pro",');
      }

      next = next.replace(/"Groq"/g, '"Grok 4.6"');
      next = next.replace(/\bGroq\s*:\s*\["Q",\s*"Fast responses"\]/g, '"Grok 4.6": ["G", "xAI Grok 4.6 · Puter"]');
      next = next.replace(/"Grok 4\.6",\s*"Gemini",\s*"Mistral"/, '"Grok 4.6", "Sonar Pro Research", "Gemini 3.1 Pro", "Gemini 3.7 Flash", "Gemini 3.5 Flash-Lite", "Claude Sonnet 5", "Claude Haiku 4.5", "Claude Opus 5", "Claude Opus 5 Fast", "Mistral"');
      next = next.replace(/"Grok 4\.6",\s*"Sonar Pro Research",\s*"Gemini",\s*"Mistral"/, '"Grok 4.6", "Sonar Pro Research", "Gemini 3.1 Pro", "Gemini 3.7 Flash", "Gemini 3.5 Flash-Lite", "Claude Sonnet 5", "Claude Haiku 4.5", "Claude Opus 5", "Claude Opus 5 Fast", "Mistral"');
      next = next.replace(/"Gemini 3\.5 Flash-Lite",\s*"Mistral"/, '"Gemini 3.5 Flash-Lite", "Claude Sonnet 5", "Claude Haiku 4.5", "Claude Opus 5", "Claude Opus 5 Fast", "Mistral"');

      const detailsAnchor = /("Grok 4\.6":\s*\["G",\s*"xAI Grok 4\.6 · Puter"\],)/;
      if (!next.includes('"Sonar Pro Research": ["P", "Perplexity · live research"]')) next = next.replace(detailsAnchor, '$1\n    "Sonar Pro Research": ["P", "Perplexity · live research"],');
      if (!next.includes('"Gemini 3.1 Pro": ["G", "Google · strongest Gemini"]')) next = next.replace(detailsAnchor, '$1\n    "Gemini 3.1 Pro": ["G", "Google · strongest Gemini"],\n    "Gemini 3.7 Flash": ["G", "Google · fast multimodal"],\n    "Gemini 3.5 Flash-Lite": ["G", "Google · fastest lightweight"],');
      if (!next.includes('"Claude Sonnet 5": ["C", "Anthropic · balanced flagship"]')) next = next.replace(detailsAnchor, '$1\n    "Claude Sonnet 5": ["C", "Anthropic · balanced flagship"],\n    "Claude Haiku 4.5": ["C", "Anthropic · fast and efficient"],\n    "Claude Opus 5": ["C", "Anthropic · maximum capability"],\n    "Claude Opus 5 Fast": ["C", "Anthropic · Opus 5 fast mode"],');

      if (!next.includes('const PROVIDER_BRAND_ICONS =')) {
        const brandRenderer = `\n\nconst PROVIDER_BRAND_ICONS = {\n  [CLAUDE_FABLE_PROVIDER]: "/model-icons/claude.svg",\n  "Claude Sonnet 5": "/model-icons/claude.svg",\n  "Claude Haiku 4.5": "/model-icons/claude.svg",\n  "Claude Opus 5": "/model-icons/claude.svg",\n  "Claude Opus 5 Fast": "/model-icons/claude.svg",\n  "Grok 4.6": "/model-icons/grok.svg",\n  "Gemini 3.1 Pro": "/model-icons/gemini.svg",\n  "Gemini 3.7 Flash": "/model-icons/gemini.svg",\n  "Gemini 3.5 Flash-Lite": "/model-icons/gemini.svg",\n  Gemini: "/model-icons/gemini.svg",\n  Mistral: "/model-icons/mistral.svg",\n  SambaNova: "/model-icons/sambanova.svg",\n};\n\nconst ProviderBrandIcon = ({ provider, fallback }) => {\n  const isOpenAI = provider === "GPT-5.6 Sol" || provider === "GPT-5.6 Terra" || provider === "GPT-5.6 Luna" || provider === "GPT-5.3 Codex";\n  if (isOpenAI) return <img src="/model-icons/openai.svg" alt="" width="18" height="18" style={{width:18,height:18,objectFit:"contain",display:"block"}} />;\n  if (provider === "Auto" || provider === "Agnes") return <span style={{width:18,height:18,overflow:"hidden",display:"block"}}><img src="/logo.png" alt="VetroAI" style={{height:18,width:"auto",maxWidth:"none",display:"block"}} /></span>;\n  const src = PROVIDER_BRAND_ICONS[provider] || (provider === "Sonar Pro Research" ? "/model-icons/perplexity.svg" : null);\n  if (!src) return <span aria-hidden="true" style={{color:"#fff"}}>{fallback || "✦"}</span>;\n  return <img src={src} alt="" width="18" height="18" style={{width:18,height:18,objectFit:"contain",display:"block"}} />;\n};`;
        next = next.replace(/(const PROVIDERS = \[[^\n]+\];)/, `$1${brandRenderer}`);
      }

      next = next.replace('<span className={`ws-model-mark model-${provider.toLowerCase().replace(/\\s+/g, "-")}`}>{mark}</span>', '<span className={`ws-model-mark model-${provider.toLowerCase().replace(/\\s+/g, "-")}`} style={{ background: "#09090b", color: "#fff", border: "1px solid rgba(255,255,255,.16)", boxShadow: "0 2px 5px rgba(0,0,0,.22)" }}><ProviderBrandIcon provider={provider} fallback={mark} /></span>');

      next = next.replace(
        /if \(fileCount > 0\) \{\s*throw new Error\(`\$\{effectivePuterProvider\} file uploads are not available yet\. Remove the attachment and send the text again\.`\);\s*\}/,
        `let puterFileContext = "";\n        if (fileCount > 0) {\n          const attachedDocs = (Array.isArray(filesData) ? filesData : filesData ? [filesData] : [])\n            .filter((file) => file instanceof File && !file.type.startsWith("image/"));\n          for (const file of attachedDocs) {\n            const lower = (file.name || "").toLowerCase();\n            const textLike = file.type.startsWith("text/") || /\\.(txt|md|csv|json|js|jsx|ts|tsx|py|java|c|cpp|h|hpp|css|html|xml|yaml|yml|sql|log)$/i.test(lower);\n            if (!textLike) throw new Error(\`Cannot extract text from \${file.name} yet. Upload PDF, TXT, CSV, JSON, Markdown, or a source-code file.\`);\n            const text = (await file.text()).trim();\n            if (text) puterFileContext += \`\\n\\n--- ATTACHED FILE: \${file.name} ---\\n\${text.slice(0, 30000)}\`;\n          }\n        }`
      );
      next = next.replace(/const puterMessages = hist\s*\.filter/, 'const puterMessages = hist\\n          .filter');
      next = next.replace(
        /if \(finalSystemPrompt\.trim\(\)\) \{\s*puterMessages\.unshift\(\{ role: "system", content: finalSystemPrompt\.trim\(\) \}\);\s*\}/,
        `if (puterFileContext) {\n          const lastUser = [...puterMessages].reverse().find((message) => message.role === "user");\n          if (lastUser) lastUser.content = \`${'${lastUser.content}'}\\n\\n[ATTACHMENTS]\${puterFileContext}\`;\n        }\n        if (finalSystemPrompt.trim()) {\n          puterMessages.unshift({ role: "system", content: finalSystemPrompt.trim() });\n        }`
      );

      return { code: next, map: null };
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [browserPuterModelsTransform(), react()],
    server: {
      port: Number(env.VITE_PORT) || 5173,
      strictPort: true,
      host: true,
      cors: { origin: '*', methods: '*', headers: '*' },
      headers: { "Cross-Origin-Opener-Policy": "same-origin-allow-popups", "Access-Control-Allow-Origin": "*" },
      proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true, secure: false } }
    },
    optimizeDeps: { include: ['leaflet', 'react-leaflet'] }
  }
})
