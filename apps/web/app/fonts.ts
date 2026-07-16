import localFont from 'next/font/local';

// Polices officielles IPD (charte 2025, vendored — cf. docs/design/
// CHARTE_OFFICIELLE_2025.md). Poppins = titres (Bold) / sous-titres (Light),
// Lato = corps. display:swap → pas de FOIT au premier rendu.
export const poppins = localFont({
  src: [
    { path: './fonts/Poppins-Light.ttf', weight: '300', style: 'normal' },
    { path: './fonts/Poppins-Bold.ttf', weight: '700', style: 'normal' },
  ],
  variable: '--font-poppins',
  display: 'swap',
});

export const lato = localFont({
  src: [{ path: './fonts/Lato-Regular.ttf', weight: '400', style: 'normal' }],
  variable: '--font-lato',
  display: 'swap',
});
