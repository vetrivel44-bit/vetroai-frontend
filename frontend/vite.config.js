import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

function grok46PuterTransform() {
  return {
    name: 'vetroai-grok-46-puter',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/App.jsx')) return null;

      let next = code;

      // Remove the obsolete frontend Groq key reference. Grok 4.6 is accessed
      // browser-side through Puter and needs no xAI/Groq developer API key.
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

      // Rename all user-visible provider strings while preserving lowercase
      // internal `groq` IDs used by Multi-AI compatibility routing.
      next = next.replace(/"Groq"/g, '"Grok 4.6"');
      next = next.replace(
        /\bGroq\s*:\s*\["Q",\s*"Fast responses"\]/g,
        '"Grok 4.6": ["G", "xAI Grok 4.6 · Puter"]'
      );

      return { code: next, map: null };
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [grok46PuterTransform(), react()],
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
