import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Test sentinelle anti-régression — Finding F22 (cf.
 * docs/audit-codebase-2026-06-02.md).
 *
 * Les générateurs de numéro de séquence (`DA-YYYY-NNNN`, `OD-YYYY-NNNN`,
 * `BC-…`, `GR-…`, `PAY-…`) dérivent leur année du préfixe via
 * `new Date().getFullYear()` — c'est-à-dire de l'horloge système réelle.
 * Un tel code n'est déterministe en test que si la suite fige l'horloge
 * (`jest.useFakeTimers` + `setSystemTime`, cf. helper test/fake-time.ts,
 * US-062). Sans ce gel, les attentes `…-2026-…` cassent au changement
 * d'année — c'est exactement la dette F22.
 *
 * Plutôt que de compter TOUS les `new Date()` (la majorité sont des
 * horodatages `updatedAt: new Date()` parfaitement légitimes et sans
 * rapport avec F22 → bruit), cette sentinelle cible le **signal précis** :
 * l'année dérivée de l'horloge, soit le motif sans argument
 * `new Date().getFullYear()`. Les variantes déterministes — `new Date(arg)`
 * (ex. `new Date(report.generatedAt).getFullYear()` dans donor-report) ou
 * `now.getFullYear()` sur une durée (grant.service) — ne sont volontairement
 * PAS capturées : elles ne dépendent pas du moment d'exécution.
 *
 * La sentinelle balaye TOUT le code de production (récursivement) : un
 * nouveau générateur introduit dans un nouveau fichier est donc détecté
 * automatiquement, pas seulement les fichiers d'une liste figée.
 *
 * Règle : toute occurrence de `new Date().getFullYear()` en production doit
 * figurer dans l'ALLOWLIST ci-dessous, avec une justification. Les entrées
 * actuelles sont des générateurs legacy dont la génération est couverte par
 * des specs à horloge figée (US-062) ; le correctif propre (dette future)
 * est l'injection d'un `ClockService` mockable. Tout AJOUT non documenté
 * fait échouer la CI.
 */

const SRC_ROOT = join(__dirname, '..');

/** Motif F22 : année dérivée de l'horloge système (new Date() sans argument). */
const CLOCK_YEAR = /new\s+Date\s*\(\s*\)\s*\.\s*getFullYear\s*\(\s*\)/g;

/**
 * Occurrences justifiées de `new Date().getFullYear()` en production.
 * Clé = chemin relatif à `src/` (séparateurs `/`), valeur = nombre toléré.
 *
 * Justification (toutes entrées) : générateur de numéro de séquence legacy
 * dont la génération est exercée sous horloge figée dans sa spec (US-062),
 * ou dont le numéro produit n'est pas asservi à une année hardcodée dans les
 * assertions. Dette propre = injecter un ClockService. Ne PAS augmenter ces
 * valeurs ni ajouter d'entrée sans (a) couvrir le générateur par une spec à
 * fakeTimers et (b) documenter ici la raison.
 */
const ALLOWLIST: Record<string, number> = {
  'accounting/services/accrual.service.ts': 1,
  'accounting/services/dedicated-funds.service.ts': 1,
  'accounting/services/posting.service.ts': 1,
  'accounting/services/prepayment.service.ts': 1,
  'invoicing/services/invoice.service.ts': 1,
  'procurement/purchase-request.service.ts': 1,
  'procurement/services/goods-receipt.service.ts': 1,
  'procurement/services/purchase-order.service.ts': 1,
  'treasury/services/payment-run.service.ts': 1,
};

/** Parcours récursif des sources de production (hors tests/test-utils/types). */
function collectProdFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue;
      collectProdFiles(full, acc);
    } else if (
      name.endsWith('.ts') &&
      !name.endsWith('.spec.ts') &&
      !name.endsWith('.d.ts') &&
      !full.includes(`${sep}test-utils${sep}`)
    ) {
      acc.push(full);
    }
  }
  return acc;
}

function relKey(full: string): string {
  return relative(SRC_ROOT, full).split(sep).join('/');
}

/** Map { cheminRelatif: nbOccurrences } pour les fichiers concernés (>0). */
const found: Record<string, number> = {};
for (const full of collectProdFiles(SRC_ROOT)) {
  const count = (readFileSync(full, 'utf-8').match(CLOCK_YEAR) ?? []).length;
  if (count > 0) found[relKey(full)] = count;
}

const REMEDIATION =
  "Risque de régression F22 : générateur de séquence dépendant de l'horloge " +
  'réelle, donc non déterministe en test sans horloge figée. Solutions : ' +
  "(a) injecter un ClockService mockable ; ou (b) couvrir le générateur par une " +
  'spec figeant la date (useFakeDate, test-utils/fake-time.ts) ET ajouter une ' +
  "entrée justifiée dans l'ALLOWLIST de ce fichier.";

describe('Sentinel F22 — pas de new Date().getFullYear() hors allowlist (générateurs de séquence)', () => {
  const auditedFiles = Array.from(
    new Set([...Object.keys(ALLOWLIST), ...Object.keys(found)]),
  ).sort();

  it.each(auditedFiles)('%s : occurrences clock-year ≤ allowlist', (rel) => {
    const count = found[rel] ?? 0;
    const allowed = ALLOWLIST[rel] ?? 0;
    if (count > allowed) {
      throw new Error(
        `${rel} contient ${count} occurrence(s) de new Date().getFullYear() ` +
          `(allowlist=${allowed}). ${REMEDIATION}`,
      );
    }
  });

  it("aucun fichier de production non documenté n'introduit new Date().getFullYear()", () => {
    const offenders = Object.keys(found).filter((f) => !(f in ALLOWLIST));
    if (offenders.length > 0) {
      throw new Error(
        `Nouvelle(s) source(s) clock-dépendante(s) hors allowlist : ` +
          `${offenders.join(', ')}. ${REMEDIATION}`,
      );
    }
  });
});
