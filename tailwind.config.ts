import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: '#4F6EF7',
        'brand-dark': '#3A56D4',
        'bg-base': '#07070F',
        'bg-card': '#0F0F1D',
        'bg-card2': '#14142A',
        'text-primary': '#EEEEF5',
        'text-muted': '#6B6B90',
        'border-subtle': 'rgba(255,255,255,0.07)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 2.5s cubic-bezier(0.4,0,0.6,1) infinite',
        'fade-up': 'fadeUp 0.5s ease-out forwards',
        'typing': 'typing 3s steps(60) 0.8s forwards',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        typing: {
          '0%': { width: '0' },
          '100%': { width: '100%' },
        },
      },
    },
  },
  plugins: [],
}

export default config
