import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        // ===== Charte IPD — aqua doux (institutionnel) =====
        // Brand color #4FC3D9. Voir docs et CLAUDE.md pour les
        // règles d'usage (AA contrast) :
        //   bg-ipd        → grandes surfaces (header, hero, login aside)
        //   bg-ipd-dark   → boutons primaires (texte blanc lisible)
        //   text-ipd-darker → texte de marque sur fond clair
        //   border-ipd    → ring focus, séparateurs
        //   bg-ipd-50/100 → fonds très doux (items actifs, hover)
        ipd: {
          DEFAULT: '#4FC3D9',
          dark: '#2BA0B8',
          darker: '#1B7A8E',
          light: '#7AD3E4',
          50: '#ECF9FC',
          100: '#D9F2F8',
          900: '#0E5060',
        },
        navy: {
          DEFAULT: '#1E3A5F',
          light: '#2D5485',
          dark: '#142847',
        },
        cream: '#FAFAF7',
        slate: {
          text: '#1F2937',
          muted: '#6B7280',
        },
        state: {
          success: '#16A34A',
          warning: '#F59E0B',
          error: '#DC2626',
        },
        // ===== shadcn/ui design tokens (HSL via CSS vars) =====
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
export default config;
