import { render, screen } from '@testing-library/react';
import type { EntityDocument } from '@/lib/api/documents';

jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { accessToken: 'test-token', expires: '2099' },
    status: 'authenticated',
  }),
}));

import { DocumentsPanel } from '../DocumentsPanel';

const DOC: EntityDocument = {
  objectKey: 'invoices/2026/07/sim-abc.pdf',
  label: 'FAC-SIM-BC-2026-0002-1.pdf',
  kind: 'invoice_pdf',
  contentType: 'application/pdf',
  sizeBytes: 245_760,
  storedAt: '2026-07-10T08:00:00.000Z',
  downloadPath: '/invoices/inv-1/pdf',
};

describe('DocumentsPanel (US-069)', () => {
  it('état chargement : skeletons, pas de liste', () => {
    render(<DocumentsPanel documents={undefined} isLoading />);
    expect(screen.getByTestId('documents-panel-chargement')).toBeInTheDocument();
    expect(screen.queryByTestId('documents-panel-liste')).toBeNull();
  });

  it('état vide charte (« Aucun document archivé ») — jamais d\'icône cassée', () => {
    render(<DocumentsPanel documents={[]} emptyMessage="Aucun document archivé pour cet élément." />);
    expect(screen.getByTestId('documents-panel-vide')).toHaveTextContent(
      'Aucun document archivé pour cet élément.',
    );
  });

  it('état erreur listing : message dédié', () => {
    render(<DocumentsPanel documents={undefined} isError />);
    expect(screen.getByTestId('documents-panel-erreur')).toBeInTheDocument();
  });

  it('happy path : nom, type FR, taille formatée + actions Aperçu / Télécharger', () => {
    render(<DocumentsPanel documents={[DOC]} inlinePreview={false} />);
    expect(screen.getByTestId('documents-panel-liste')).toBeInTheDocument();
    expect(screen.getByText('FAC-SIM-BC-2026-0002-1.pdf')).toBeInTheDocument();
    expect(screen.getByText(/Facture fournisseur \(PDF\)/)).toBeInTheDocument();
    expect(screen.getByText(/240 Ko/)).toBeInTheDocument();
    expect(screen.getByTestId('document-apercu-invoice_pdf')).toBeInTheDocument();
    expect(screen.getByTestId('document-telecharger-invoice_pdf')).toBeInTheDocument();
  });

  it('taille null (stockage down au listing) : la ligne reste affichée sans taille', () => {
    render(<DocumentsPanel documents={[{ ...DOC, sizeBytes: null }]} inlinePreview={false} />);
    expect(screen.getByText('FAC-SIM-BC-2026-0002-1.pdf')).toBeInTheDocument();
    expect(screen.queryByText(/Ko/)).toBeNull();
  });
});
