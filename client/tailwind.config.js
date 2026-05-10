/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'bg-dark': '#070709',
        'bg-card': '#0f0f13',
        'bg-hover': '#16161d',
        'border': 'rgba(255, 255, 255, 0.08)',
        'text-main': '#f0f0f5',
        'text-dim': '#888891',
        'accent-purple': '#9d4edd',
        'accent-yellow': '#ffb703',
        'accent-green': '#00f5d4',
        'accent-red': '#ff5d8f',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
