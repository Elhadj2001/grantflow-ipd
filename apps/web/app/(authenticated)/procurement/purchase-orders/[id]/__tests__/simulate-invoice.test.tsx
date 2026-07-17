import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * Sprint F-INVOICE-SIM — tests RTL du bouton + dialog "Simuler la facture
 * fournisseur (démo)" sur la page détail BC.
 *
 * On mocke tous les hooks externes (router, session, react-query) pour
 * isoler la logique de gating (statut + rôle + flag) et le routage des
 * deux modes vers les fonctions API.
 */

// --- Mocks de navigation / session ---
const pushMock = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'po-1' }),
  useRouter: () => ({ push: pushMock }),
}));
jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'tok' } }),
}));

// --- Mocks des hooks de données ---
const poData = {
  id: 'po-1',
  poNumber: 'BC-2026-0001',
  status: 'sent',
  currency: 'XOF',
  supplierId: 'sup-1',
  orderDate: '2026-05-01',
  expectedDate: null,
  prId: null,
  totalHt: 100000,
  totalVat: 18000,
  totalTtc: 118000,
  lines: [
    { id: 'l1', lineNumber: 1, description: 'Réactif', quantity: 10, unit: 'u', unitPrice: 10000, lineTotal: 100000 },
  ],
};

let poStatus = 'sent';
jest.mock('@/hooks/use-procurement', () => ({
  usePO: () => ({ isLoading: false, data: { ...poData, status: poStatus } }),
  useSendPO: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useAcknowledgePO: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useCancelPO: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

let canSim = true;
jest.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    canManagePO: () => true,
    canReceive: () => false,
    canSimulateInvoice: () => canSim,
  }),
}));

let flagOn = true;
jest.mock('@/hooks/use-features', () => ({
  useFeatures: () => ({ features: { demoInvoiceSimulator: flagOn } }),
}));

const toastMock = jest.fn();
jest.mock('@/hooks/use-toast', () => ({ toast: (...args: unknown[]) => toastMock(...args) }));

// US-069 : la page monte le panneau Documents (usePoDocuments = useQuery) —
// stub sans QueryClient, le panneau lui-même a sa propre suite de tests.
jest.mock('@/hooks/use-documents', () => ({
  usePoDocuments: () => ({ data: [], isLoading: false, isError: false }),
}));

// --- Mocks des fonctions API ---
const injectMock = jest.fn();
const downloadMock = jest.fn();
jest.mock('@/lib/api/procurement', () => ({
  simulateInvoiceInject: (...args: unknown[]) => injectMock(...args),
  simulateInvoiceDownload: (...args: unknown[]) => downloadMock(...args),
}));

import PurchaseOrderDetailPage from '../page';

describe('PO détail — bouton simulateur facture (F-INVOICE-SIM)', () => {
  beforeEach(() => {
    poStatus = 'sent';
    canSim = true;
    flagOn = true;
    pushMock.mockReset();
    toastMock.mockReset();
    injectMock.mockReset();
    downloadMock.mockReset();
  });

  it('affiche le bouton si statut sent + rôle OK + flag ON', () => {
    render(<PurchaseOrderDetailPage />);
    expect(screen.getByTestId('action-simulate-invoice')).toBeInTheDocument();
  });

  it('masque le bouton si flag OFF', () => {
    flagOn = false;
    render(<PurchaseOrderDetailPage />);
    expect(screen.queryByTestId('action-simulate-invoice')).not.toBeInTheDocument();
  });

  it('masque le bouton si statut ≠ sent', () => {
    poStatus = 'draft';
    render(<PurchaseOrderDetailPage />);
    expect(screen.queryByTestId('action-simulate-invoice')).not.toBeInTheDocument();
  });

  it('masque le bouton si rôle insuffisant', () => {
    canSim = false;
    render(<PurchaseOrderDetailPage />);
    expect(screen.queryByTestId('action-simulate-invoice')).not.toBeInTheDocument();
  });

  it('mode inject → appelle simulateInvoiceInject + redirige vers la facture', async () => {
    injectMock.mockResolvedValue({ invoiceId: 'inv-9', invoiceNumber: 'FAC-SIM-BC-2026-0001-1', mode: 'inject' });
    render(<PurchaseOrderDetailPage />);
    fireEvent.click(screen.getByTestId('action-simulate-invoice'));
    fireEvent.click(screen.getByTestId('simulate-mode-inject'));
    await waitFor(() => expect(injectMock).toHaveBeenCalledWith('po-1', { accessToken: 'tok' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/accounting/invoices/inv-9'));
  });

  it('mode download → appelle simulateInvoiceDownload', async () => {
    downloadMock.mockResolvedValue({ blob: new Blob(['%PDF']), filename: 'FAC-SIM.pdf' });
    // jsdom : stub des APIs DOM utilisées par le download.
    global.URL.createObjectURL = jest.fn(() => 'blob:x');
    global.URL.revokeObjectURL = jest.fn();
    render(<PurchaseOrderDetailPage />);
    fireEvent.click(screen.getByTestId('action-simulate-invoice'));
    fireEvent.click(screen.getByTestId('simulate-mode-download'));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledWith('po-1', { accessToken: 'tok' }));
  });
});
