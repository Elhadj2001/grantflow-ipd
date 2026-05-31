/**
 * Fix create-grant-nullable — tests Zod sur les champs optionnels
 * signedAt + notes : doivent accepter `null` (envoyé par les formulaires
 * web) ET `undefined` (champ absent). Symétrique avec UpdateGrantSchema
 * qui utilise déjà `.nullable().optional()`.
 */

import { CreateGrantSchema } from '../create-grant.dto';

const baseValid = {
  reference: 'BMGF-2026-001',
  donorId: '11111111-1111-1111-1111-111111111111',
  projectId: '22222222-2222-2222-2222-222222222222',
  amount: '100000',
  currency: 'XOF' as const,
  overheadRate: 0.15,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  status: 'draft' as const,
};

describe('CreateGrantSchema — signedAt + notes nullish (fix create-grant-nullable)', () => {
  it('accepte signedAt=null (envoyé par formulaire web vide)', () => {
    const parsed = CreateGrantSchema.parse({ ...baseValid, signedAt: null });
    expect(parsed.signedAt).toBeNull();
  });

  it('accepte notes=null', () => {
    const parsed = CreateGrantSchema.parse({ ...baseValid, notes: null });
    expect(parsed.notes).toBeNull();
  });

  it('accepte signedAt absent (undefined)', () => {
    const parsed = CreateGrantSchema.parse(baseValid);
    expect(parsed.signedAt).toBeUndefined();
  });

  it('accepte notes absent (undefined)', () => {
    const parsed = CreateGrantSchema.parse(baseValid);
    expect(parsed.notes).toBeUndefined();
  });

  it('accepte les deux à null en même temps (cas réel formulaire vide)', () => {
    const parsed = CreateGrantSchema.parse({
      ...baseValid,
      signedAt: null,
      notes: null,
    });
    expect(parsed.signedAt).toBeNull();
    expect(parsed.notes).toBeNull();
  });

  it('accepte les valeurs renseignées (non-régression)', () => {
    const parsed = CreateGrantSchema.parse({
      ...baseValid,
      signedAt: '2026-01-15',
      notes: 'Convention signée par le DAF.',
    });
    expect(parsed.signedAt).toBe('2026-01-15');
    expect(parsed.notes).toBe('Convention signée par le DAF.');
  });

  it('rejette signedAt mal formaté (non-régression validation)', () => {
    expect(() =>
      CreateGrantSchema.parse({ ...baseValid, signedAt: '15/01/2026' }),
    ).toThrow(/ISO 8601/);
  });

  it('rejette notes > 2000 caractères (non-régression)', () => {
    const longNotes = 'a'.repeat(2001);
    expect(() =>
      CreateGrantSchema.parse({ ...baseValid, notes: longNotes }),
    ).toThrow();
  });
});
