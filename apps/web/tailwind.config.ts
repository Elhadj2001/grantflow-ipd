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
        // ===== Charte officielle IPD 2025 (bleu #0089D0) =====
        // Source : docs/design/CHARTE_OFFICIELLE_2025.md (tokens du projet
        // « Enregistrement Fact et Paie »). Aucun hex de marque dans les
        // composants : uniquement ces tokens. Règles AA : cf. CLAUDE.md §4.
        ipd: {
          // -- Tokens charte (référence) --
          bleu: '#0089D0',
          'bleu-dk': '#0070AD',
          'bleu-fonce': '#055A8C',
          'bleu-clair': '#86B4DD',
          navy: '#052A62',
          'navy-2': '#03204A',
          beige: '#E3E0D8',
          taupe: '#BFB8B0',
          gris: '#D7D8DB',
          'gris-clair': '#F2F3F5',
          ink: '#000000',
          'bordure-carte': '#E5E1D8',
          muet: '#5B6675',
          'tab-entete': '#8A93A2',
          'tab-fond': '#FAFAF8',
          // Accents fonctionnels (hors charte de marque)
          vert: '#1B6E3A',
          ambre: '#C9881A',
          rouge: '#9A1F1F',
          // Teintes douces (fonds/bordures des badges + bandeaux)
          'bleu-tint': '#E6F2FB',
          'bleu-pale': '#F7FBFE',
          'bleu-bordure': '#E0EEF9',
          'bleu-bordure-info': '#CFE6F6',
          'vert-tint': '#DCF3E3',
          'ambre-tint': '#FBEFD3',
          'ambre-fonce': '#8A5A00',
          'ambre-bordure': '#F0DCAE',
          'rouge-tint': '#FBDDDD',
          'rouge-bordure': '#F0B4B4',
          ardoise: '#4A5566',
          ligne: '#F0F1F1',
          // Sidebar / hero (dégradé navy)
          'hero-texte': '#EAF2FB',
          'hero-sous': '#CFE0F3',
          'nav-texte': '#CDDDEF',
          'nav-muet': '#7FA3CF',
          // -- Alias LEGACY (classes historiques bg-ipd / bg-ipd-dark /
          // text-ipd-darker / bg-ipd-50…) remappés sur la charte 2025 :
          // toute page non encore balayée adopte le bleu officiel. --
          DEFAULT: '#0089D0',
          dark: '#0070AD',
          darker: '#055A8C',
          light: '#86B4DD',
          50: '#E6F2FB',
          100: '#E0EEF9',
          900: '#03204A',
        },
        navy: {
          DEFAULT: '#052A62',
          light: '#0E3F86',
          dark: '#03204A',
        },
        slate: {
          text: '#1F2937',
          muted: '#5B6675',
        },
        state: {
          success: '#1B6E3A',
          warning: '#C9881A',
          error: '#9A1F1F',
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
        carte: '12px',
        btn: '10px',
      },
      boxShadow: {
        douce: '0 1px 3px rgba(5,42,98,.06)',
        carte: '0 6px 24px rgba(5,42,98,.12)',
        btn: '0 2px 8px rgba(0,137,208,.28)',
        'btn-h': '0 4px 14px rgba(0,137,208,.32)',
        login: '0 24px 70px rgba(0,0,0,.42)',
        actif: 'inset 3px 0 0 #0089D0',
      },
      fontFamily: {
        // Lato = corps par défaut (font-sans hérité partout), Poppins = titres.
        sans: ['var(--font-lato)', 'system-ui', 'sans-serif'],
        titre: ['var(--font-poppins)', 'sans-serif'],
        corps: ['var(--font-lato)', 'sans-serif'],
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
