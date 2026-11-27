/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#eef2f8', 100: '#d9e2f0', 200: '#b3c5e0', 300: '#8aa5cd', 400: '#5f81b4',
          500: '#3f63a0', 600: '#2f4d84', 700: '#243b68', 800: '#1b2d52', 900: '#121f3a', 950: '#0b1428'
        }
      },
      fontFamily: { sans: ['Inter', '"Segoe UI"', 'Arial', 'system-ui', 'sans-serif'] }
    }
  },
  plugins: []
};
