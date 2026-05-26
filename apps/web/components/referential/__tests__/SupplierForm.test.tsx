import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SupplierForm } from '../SupplierForm';
import type { Supplier } from '@/lib/api/referential';

describe('SupplierForm', () => {
  const baseSupplier: Supplier = {
    id: 'sup-1',
    code: 'BIOMED_SN',
    name: 'BioMed Sénégal SARL',
    vatNumber: 'SN12345',
    address: 'Km 4.5 Route de Rufisque',
    country: 'SN',
    iban: null,
    bic: null,
    bankName: null,
    paymentTermsDays: 30,
    currencyDefault: 'XOF',
    riskScore: 10,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
  };

  it('mode create : champs vides, code éditable', () => {
    render(<SupplierForm mode="create" onSubmit={jest.fn()} />);
    expect(screen.getByTestId('supplier-form')).toHaveAttribute('data-mode', 'create');
    expect(screen.getByTestId('supplier-code')).not.toBeDisabled();
    expect((screen.getByTestId('supplier-code') as HTMLInputElement).value).toBe('');
  });

  it('mode edit : champs préremplis, code immuable (disabled)', () => {
    render(
      <SupplierForm mode="edit" defaultValues={baseSupplier} onSubmit={jest.fn()} />,
    );
    expect(screen.getByTestId('supplier-form')).toHaveAttribute('data-mode', 'edit');
    expect(screen.getByTestId('supplier-code')).toBeDisabled();
    expect((screen.getByTestId('supplier-code') as HTMLInputElement).value).toBe(
      'BIOMED_SN',
    );
    expect((screen.getByTestId('supplier-name') as HTMLInputElement).value).toBe(
      'BioMed Sénégal SARL',
    );
  });

  it('validation Zod : code minuscule → erreur, pas de submit', async () => {
    const onSubmit = jest.fn();
    render(<SupplierForm mode="create" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId('supplier-code'), {
      target: { value: 'biomed' }, // minuscule
    });
    fireEvent.change(screen.getByTestId('supplier-name'), {
      target: { value: 'BioMed' },
    });
    fireEvent.click(screen.getByTestId('supplier-form-submit'));
    await waitFor(() => {
      expect(screen.getByText(/Code MAJUSCULES/i)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submit en mode create : envoie un CreateSupplierInput nettoyé (undefined si vide)', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    render(<SupplierForm mode="create" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId('supplier-code'), {
      target: { value: 'CUSTOM_SUP' },
    });
    fireEvent.change(screen.getByTestId('supplier-name'), {
      target: { value: 'Custom Supplier' },
    });
    fireEvent.change(screen.getByTestId('supplier-country'), {
      target: { value: 'SN' },
    });
    fireEvent.click(screen.getByTestId('supplier-form-submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CUSTOM_SUP',
        name: 'Custom Supplier',
        country: 'SN',
        currencyDefault: 'XOF',
        paymentTermsDays: 30,
        riskScore: 0,
        // Champs non remplis → undefined (CreateSupplierInput)
        vatNumber: undefined,
        iban: undefined,
        bic: undefined,
      }),
    );
  });

  it('submit en mode edit : envoie un UpdateSupplierInput avec null pour les champs effacés', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    render(
      <SupplierForm mode="edit" defaultValues={baseSupplier} onSubmit={onSubmit} />,
    );
    // Vide le vatNumber existant pour tester le null = clear
    fireEvent.change(screen.getByTestId('supplier-vat'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('supplier-form-submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.vatNumber).toBeNull(); // clear côté PATCH
    expect(payload.address).toBe('Km 4.5 Route de Rufisque'); // inchangé
  });

  it('errorMessage affiché si transmis', () => {
    render(
      <SupplierForm
        mode="create"
        onSubmit={jest.fn()}
        errorMessage="Erreur 409 — DUPLICATE_CODE"
      />,
    );
    expect(screen.getByTestId('supplier-form-error')).toHaveTextContent(/DUPLICATE_CODE/);
  });

  it('nom trop court (< 3) → erreur Zod, pas de submit', async () => {
    const onSubmit = jest.fn();
    render(<SupplierForm mode="create" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId('supplier-code'), {
      target: { value: 'SUP1' },
    });
    fireEvent.change(screen.getByTestId('supplier-name'), {
      target: { value: 'AB' }, // 2 caractères
    });
    fireEvent.click(screen.getByTestId('supplier-form-submit'));
    await waitFor(() => {
      expect(screen.getByText(/Min 3 caractères/i)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
