/**
 * US-075 (F-S8-01) — l'iframe d'aperçu ne doit JAMAIS porter d'attribut
 * `sandbox` : Chromium refuse d'instancier son viewer PDF dans une iframe
 * sandboxée (aperçu blanc pour tout document — bug prod audit v2).
 */
import { render, screen, waitFor } from '@testing-library/react';

jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { accessToken: 'test-token', expires: '2099' },
    status: 'authenticated',
  }),
}));

const apiFetchBlobMock = jest.fn();
jest.mock('@/lib/api-client', () => {
  const actual = jest.requireActual('@/lib/api-client');
  return {
    ...actual,
    apiFetchBlob: (...args: unknown[]) => apiFetchBlobMock(...args),
  };
});

import { ApercuPdf } from '../DocumentViewer';

describe('ApercuPdf (US-075 — F-S8-01)', () => {
  beforeAll(() => {
    // jsdom n'implémente pas createObjectURL
    global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = jest.fn();
  });

  beforeEach(() => {
    apiFetchBlobMock.mockReset();
  });

  it("rend l'iframe SANS attribut sandbox quand le PDF charge", async () => {
    apiFetchBlobMock.mockResolvedValue({
      blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
      contentType: 'application/pdf',
      filename: 'doc.pdf',
    });
    render(<ApercuPdf path="/invoices/inv-1/pdf" titre="Facture" />);
    const iframe = await screen.findByTestId('document-apercu-iframe');
    expect(iframe).not.toHaveAttribute('sandbox');
    expect(iframe).toHaveAttribute('src', expect.stringContaining('blob:mock-url'));
  });

  it('404 → état vide charte « Aucun document archivé »', async () => {
    const { ApiError } = jest.requireActual('@/lib/api-client');
    apiFetchBlobMock.mockRejectedValue(new ApiError(404, { code: 'BUSINESS.DOCUMENT_NOT_FOUND' }));
    render(<ApercuPdf path="/invoices/inv-1/pdf" titre="Facture" />);
    await waitFor(() =>
      expect(screen.getByTestId('document-etat-vide')).toHaveTextContent('Aucun document archivé.'),
    );
  });
});
