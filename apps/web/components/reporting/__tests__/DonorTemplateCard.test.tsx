import { render, screen } from '@testing-library/react';
import { DonorTemplateCard } from '../DonorTemplateCard';
import type { DonorTemplateSummary } from '@/lib/api/reporting';

jest.mock('next/link', () => {
  return function MockLink({
    children,
    href,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  };
});

const baseTemplate: DonorTemplateSummary = {
  id: 't1',
  code: 'CUSTOM_TPL',
  name: 'Template custom IPD',
  donorId: 'd1',
  currency: 'USD',
  format: {},
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  donor: { code: 'BMGF', label: 'Gates Foundation' },
  _count: { categories: 5, mappings: 12 },
};

describe('DonorTemplateCard', () => {
  it('affiche code, nom, bailleur, currency et counts', () => {
    render(<DonorTemplateCard template={baseTemplate} />);
    expect(screen.getByText('CUSTOM_TPL')).toBeInTheDocument();
    expect(screen.getByText('Template custom IPD')).toBeInTheDocument();
    expect(screen.getByText('Gates Foundation')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getByTestId('categories-count')).toHaveTextContent('5');
    expect(screen.getByTestId('mappings-count')).toHaveTextContent('12');
  });

  it('pas de badge "Officiel" sur un template custom', () => {
    render(<DonorTemplateCard template={baseTemplate} />);
    expect(screen.getByTestId('donor-template-card')).toHaveAttribute('data-official', 'false');
    expect(screen.queryByText('Officiel')).toBeNull();
  });

  it('badge "Officiel" sur les codes seedés (USAID_FFR425, OMS_STANDARD, WELLCOME_TRUST)', () => {
    render(<DonorTemplateCard template={{ ...baseTemplate, code: 'USAID_FFR425' }} />);
    expect(screen.getByTestId('donor-template-card')).toHaveAttribute('data-official', 'true');
    expect(screen.getByText('Officiel')).toBeInTheDocument();
  });

  it('libellé "multi-bailleurs" quand donor=null', () => {
    render(<DonorTemplateCard template={{ ...baseTemplate, donor: null }} />);
    expect(screen.getByText(/multi-bailleurs/i)).toBeInTheDocument();
  });

  it('lien par défaut vers /reporting/templates/:id', () => {
    render(<DonorTemplateCard template={baseTemplate} />);
    expect(screen.getByTestId('donor-template-card')).toHaveAttribute(
      'href',
      '/reporting/templates/t1',
    );
  });

  it('href overridable', () => {
    render(<DonorTemplateCard template={baseTemplate} href="/custom" />);
    expect(screen.getByTestId('donor-template-card')).toHaveAttribute('href', '/custom');
  });
});
