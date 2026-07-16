# Charte graphique IPD — Tokens officiels 2025

Source : `Charte Graphique IPD/Charte graphique FR & Brand Manual EN/IPD_Charte_Graphique-fr – 2025.pdf`
(extrait par Cowork le 19/06/2026). **Référence officielle** — remplace l'ancienne approximation (`IPD_design_system.md`).

## Couleurs

### Principales (titres, sous-titres, accents, boutons, mises en évidence)
| Rôle | HEX |
|---|---|
| Noir | `#000000` |
| **Bleu IPD (primaire)** | **`#0089D0`** |

### Secondaires (soutien des principales — graphiques, icônes)
| Nom | HEX |
|---|---|
| Beige clair | `#E3E0D8` |
| Taupe | `#BFB8B0` |
| Navy profond | `#052A62` |
| Bleu clair | `#86B4DD` |

### Neutres (fonds, séparateurs, texte alternatif sur fond sombre)
| Nom | HEX |
|---|---|
| Gris clair | `#D7D8DB` |
| Gris très clair | `#F2F3F5` |
| Blanc | `#FFFFFF` |

> ⚠️ Plus d'ambre, plus de cobalt `#1D6FD6`, plus de navy `#1A2B4A` (anciens tokens approximatifs à retirer).

## Typographie
| Niveau | Police |
|---|---|
| Titre | **Poppins — Bold** |
| Sous-titres | **Poppins — Light** (en bleu `#0089D0`) |
| Corps de texte | **Lato — Regular** |

Replis si police absente : Helvetica / Arial.

## Logo
Fichiers officiels (dossier `assets/`) :
- `logo_ipd_couleur.png` — logo couleur (globe noir + « INSTITUT PASTEUR » noir + « de Dakar » bleu) → sur fonds clairs.
- `logo_ipd_blanc.png` — version négative (blanche) → sur fonds sombres (ex. bandeau bleu/navy).
- `logo_ipd_noir.png` — monochrome noir.

## Jetons (référence rapide)
```css
--ipd-bleu:#0089D0;   /* primaire */
--ipd-noir:#000000;
--ipd-navy:#052A62;   /* secondaire */
--ipd-bleu-clair:#86B4DD;
--ipd-beige:#E3E0D8;
--ipd-taupe:#BFB8B0;
--ipd-gris:#D7D8DB;
--ipd-gris-clair:#F2F3F5;
--ipd-blanc:#FFFFFF;
/* Typo */
--ipd-titre:"Poppins"; /* Bold */
--ipd-sous-titre:"Poppins"; /* Light */
--ipd-corps:"Lato";    /* Regular */
```
