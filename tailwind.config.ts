import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f3f6ff',
          100: '#e6ecff',
          500: '#4f5eff',
          600: '#3d4bf5',
          700: '#2f3ad1'
        }
      }
    }
  },
  plugins: []
};
export default config;
