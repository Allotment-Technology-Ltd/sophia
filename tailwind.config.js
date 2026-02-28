/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        sophia: {
          // Light mode
          bg: '#F8F7F4',
          surface: '#EFEEE9',
          text: '#2A2725',
          muted: '#6B6359',
          sage: '#6B8E6F',
          copper: '#C67C4E',
          blue: '#4A7BA7',
          // Dark mode
          'dark-bg': '#1A1917',
          'dark-surface': '#141312',
          'dark-surface-raised': '#201F1D',
          'dark-text': '#E8E6E1',
          'dark-muted': '#9E9A93',
          'dark-dim': '#4A4845',
          'dark-border': '#2E2C29',
          'dark-sage': '#7FA383',
          'dark-copper': '#D4936F',
          'dark-blue': '#6FA3D4'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['Cormorant Garamond', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'Courier New', 'monospace']
      }
    }
  },
  plugins: [require('@tailwindcss/typography')]
};
