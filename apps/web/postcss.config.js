/**
 * Configuration PostCSS pour Next.js + Tailwind.
 *
 * Sans ce fichier, Next.js ne lance pas Tailwind sur le CSS et les
 * directives @tailwind base/components/utilities ne sont pas remplacées.
 * Résultat : aucune classe utilitaire ne s'applique et le rendu HTML
 * est complètement non-stylé.
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
