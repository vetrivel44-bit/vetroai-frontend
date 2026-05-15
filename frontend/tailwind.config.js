/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'claude-bg': '#F7F7F5',
        'claude-sidebar': '#EFEFEA',
        'claude-border': '#E5E5E0',
        'claude-user-msg': '#EAEAEA',
        'claude-ai-msg': '#FFFFFF',
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro', 'sans-serif'],
      },
      boxShadow: {
        'claude': '0 2px 10px rgba(0, 0, 0, 0.05)',
      }
    },
  },
  plugins: [],
}
