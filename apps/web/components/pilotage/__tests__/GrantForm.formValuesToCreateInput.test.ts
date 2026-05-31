/**
 * Fix create-grant-nullable — tests de la fonction pure
 * `formValuesToCreateInput` qui normalise les valeurs RHF en payload API.
 *
 * Pour les champs OPTIONNELS (signedAt, notes), une chaîne vide ou
 * whitespace-only doit produire `undefined` — JSON.stringify omet alors
 * la clé, ce qui évite que le backend reçoive `null` sur un schéma
 * `.optional()` strict.
 */

// L'import de GrantForm.tsx tire DonorPicker → use-referential → lib/api
// avec des dépendances qui plantent sous jsdom. On stube les pickers en
// composants minimaux pour pouvoir tester la fonction pure formValuesToCreateInput.
jest.mock('@/components/procurement/pickers/DonorPicker', () => ({
  DonorPicker: () => null,
}));
jest.mock('@/components/procurement/pickers/ProjectPicker', () => ({
  ProjectPicker: () => null,
}));

import {
  formValuesToCreateInput,
  type GrantFormValues,
} from '../GrantForm';

const baseValid: GrantFormValues = {
  reference: 'BMGF-2026-001',
  donorId: '11111111-1111-1111-1111-111111111111',
  projectId: '22222222-2222-2222-2222-222222222222',
  amount: '100000',
  currency: 'XOF',
  overheadRate: 0.15,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  status: 'draft',
  signedAt: '',
  notes: '',
};

describe('formValuesToCreateInput — fix create-grant-nullable', () => {
  it('signedAt et notes vides → undefined (clés retirées par JSON.stringify)', () => {
    const payload = formValuesToCreateInput(baseValid);
    expect(payload.signedAt).toBeUndefined();
    expect(payload.notes).toBeUndefined();
    // Et le payload sérialisé ne doit PAS contenir les clés.
    const serialized = JSON.parse(JSON.stringify(payload));
    expect('signedAt' in serialized).toBe(false);
    expect('notes' in serialized).toBe(false);
  });

  it('signedAt et notes whitespace-only → undefined (trim)', () => {
    const payload = formValuesToCreateInput({
      ...baseValid,
      signedAt: '   ',
      notes: '\n  \t',
    });
    expect(payload.signedAt).toBeUndefined();
    expect(payload.notes).toBeUndefined();
  });

  it('signedAt et notes renseignés → conservés et trimés', () => {
    const payload = formValuesToCreateInput({
      ...baseValid,
      signedAt: '  2026-01-15  ',
      notes: '  Convention signée  ',
    });
    expect(payload.signedAt).toBe('2026-01-15');
    expect(payload.notes).toBe('Convention signée');
  });

  it('champs obligatoires inchangés (non-régression)', () => {
    const payload = formValuesToCreateInput(baseValid);
    expect(payload.reference).toBe('BMGF-2026-001');
    expect(payload.donorId).toBe('11111111-1111-1111-1111-111111111111');
    expect(payload.amount).toBe('100000');
    expect(payload.currency).toBe('XOF');
    expect(payload.overheadRate).toBe(0.15);
    expect(payload.startDate).toBe('2026-01-01');
    expect(payload.endDate).toBe('2026-12-31');
    expect(payload.status).toBe('draft');
  });

  it('NE jamais envoyer null (régression du bug original)', () => {
    const payload = formValuesToCreateInput(baseValid);
    // Le bug original envoyait `null` — on s'assure que ça n'arrive plus.
    expect(payload.signedAt).not.toBeNull();
    expect(payload.notes).not.toBeNull();
  });
});
