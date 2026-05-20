import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DonorReportWizard } from '../DonorReportWizard';
import type { DonorTemplateSummary } from '@/lib/api/reporting';
import type { Grant } from '@/lib/api/referential';

const grants: Grant[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    reference: 'BMGF-2024-001',
    donorId: 'd1',
    projectId: 'p1',
    amount: '500000',
    currency: 'USD',
    overheadRate: '0.15',
    startDate: '2024-01-01',
    endDate: '2027-12-31',
    status: 'active',
    signedAt: null,
    notes: null,
    createdAt: '2024-01-01T00:00:00Z',
  },
];

const templates: DonorTemplateSummary[] = [
  {
    id: '22222222-2222-2222-2222-222222222222',
    code: 'USAID_FFR425',
    name: 'USAID FFR-425',
    donorId: 'd1',
    currency: 'USD',
    format: {},
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    donor: { code: 'BMGF', label: 'Gates' },
    _count: { categories: 6, mappings: 12 },
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    code: 'EMPTY_TPL',
    name: 'Template sans mappings',
    donorId: null,
    currency: 'EUR',
    format: {},
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    donor: null,
    _count: { categories: 0, mappings: 0 },
  },
];

describe('DonorReportWizard', () => {
  it('démarre au step grant (idx 0)', () => {
    render(
      <DonorReportWizard grants={grants} templates={templates} onSubmit={jest.fn()} />,
    );
    const wiz = screen.getByTestId('donor-report-wizard');
    expect(wiz).toHaveAttribute('data-step', 'grant');
    expect(wiz).toHaveAttribute('data-step-idx', '0');
  });

  it('bouton Suivant désactivé tant que pas de grant sélectionné', () => {
    render(
      <DonorReportWizard grants={grants} templates={templates} onSubmit={jest.fn()} />,
    );
    expect(screen.getByTestId('wizard-next')).toBeDisabled();
  });

  it('sélection grant → passage au step template', async () => {
    render(
      <DonorReportWizard grants={grants} templates={templates} onSubmit={jest.fn()} />,
    );
    fireEvent.click(screen.getByTestId(`grant-option-${grants[0].id}`));
    fireEvent.click(screen.getByTestId('wizard-next'));
    await waitFor(() =>
      expect(screen.getByTestId('donor-report-wizard')).toHaveAttribute('data-step', 'template'),
    );
  });

  it('bouton Précédent désactivé sur le step 0', () => {
    render(
      <DonorReportWizard grants={grants} templates={templates} onSubmit={jest.fn()} />,
    );
    expect(screen.getByTestId('wizard-prev')).toBeDisabled();
  });

  it('navigation complète jusqu\'au preview', async () => {
    render(
      <DonorReportWizard grants={grants} templates={templates} onSubmit={jest.fn()} />,
    );
    // Step 1 : grant
    fireEvent.click(screen.getByTestId(`grant-option-${grants[0].id}`));
    fireEvent.click(screen.getByTestId('wizard-next'));
    // Step 2 : template
    await waitFor(() => screen.getByTestId(`template-option-${templates[0].id}`));
    fireEvent.click(screen.getByTestId(`template-option-${templates[0].id}`));
    fireEvent.click(screen.getByTestId('wizard-next'));
    // Step 3 : period — preset Q1 2026
    await waitFor(() => screen.getByTestId('preset-q1'));
    fireEvent.click(screen.getByTestId('preset-q1'));
    fireEvent.click(screen.getByTestId('wizard-next'));
    // Step 4 : preview
    await waitFor(() =>
      expect(screen.getByTestId('donor-report-wizard')).toHaveAttribute('data-step', 'preview'),
    );
    expect(screen.getByTestId('wizard-submit')).toBeInTheDocument();
  });

  it('progress bar reflète l\'état des steps', () => {
    render(
      <DonorReportWizard grants={grants} templates={templates} onSubmit={jest.fn()} />,
    );
    expect(screen.getByTestId('wizard-step-grant')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('wizard-step-template')).toHaveAttribute('data-active', 'false');
  });
});
