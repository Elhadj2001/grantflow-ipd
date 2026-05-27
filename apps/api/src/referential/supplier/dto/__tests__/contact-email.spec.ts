/**
 * Sprint F-PO-EMAIL — tests Zod du nouveau champ `contactEmail`
 * sur Create/UpdateSupplierDto.
 *
 * Le reste des champs n'est pas re-testé ici (déjà couvert par
 * supplier.service.spec.ts indirectement). On valide juste la
 * sémantique du contact e-mail :
 *   - optionnel (objet sans le champ → OK)
 *   - validé via Zod.email() sur les valeurs non vides
 *   - max 255 caractères
 *   - en Update : nullable (effacement explicite)
 */

import { CreateSupplierSchema } from '../create-supplier.dto';
import { UpdateSupplierSchema } from '../update-supplier.dto';

const baseCreate = {
  code: 'FOURN-TEST',
  name: 'Fournisseur Test',
  paymentTermsDays: 30,
  currencyDefault: 'XOF' as const,
  riskScore: 0,
};

describe('Supplier DTO — contactEmail (sprint F-PO-EMAIL)', () => {
  describe('Create', () => {
    it('accepte une adresse e-mail valide', () => {
      const parsed = CreateSupplierSchema.parse({
        ...baseCreate,
        contactEmail: 'achats@biomed-sn.demo',
      });
      expect(parsed.contactEmail).toBe('achats@biomed-sn.demo');
    });

    it('accepte une création SANS contactEmail (champ optionnel)', () => {
      const parsed = CreateSupplierSchema.parse(baseCreate);
      expect(parsed.contactEmail).toBeUndefined();
    });

    it('rejette une adresse e-mail invalide', () => {
      expect(() =>
        CreateSupplierSchema.parse({ ...baseCreate, contactEmail: 'pas-une-adresse' }),
      ).toThrow(/e-mail invalide|Invalid email/i);
    });

    it('rejette une adresse e-mail > 255 caractères', () => {
      const longLocal = 'a'.repeat(250);
      const overlong = `${longLocal}@xx.demo`; // 250 + 8 = 258
      expect(() =>
        CreateSupplierSchema.parse({ ...baseCreate, contactEmail: overlong }),
      ).toThrow();
    });

    it('rejette une chaîne vide (Zod.email() refuse)', () => {
      expect(() =>
        CreateSupplierSchema.parse({ ...baseCreate, contactEmail: '' }),
      ).toThrow();
    });
  });

  describe('Update', () => {
    it('accepte une adresse e-mail valide', () => {
      const parsed = UpdateSupplierSchema.parse({ contactEmail: 'commande@labequip.demo' });
      expect(parsed.contactEmail).toBe('commande@labequip.demo');
    });

    it('accepte null pour effacement explicite (nullable)', () => {
      const parsed = UpdateSupplierSchema.parse({ contactEmail: null });
      expect(parsed.contactEmail).toBeNull();
    });

    it('accepte un payload sans le champ (no-op)', () => {
      const parsed = UpdateSupplierSchema.parse({ name: 'Nouveau nom' });
      expect(parsed.contactEmail).toBeUndefined();
    });

    it('rejette une adresse invalide en update', () => {
      expect(() => UpdateSupplierSchema.parse({ contactEmail: 'pas-valide@' })).toThrow();
    });
  });
});
