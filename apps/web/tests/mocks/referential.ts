/**
 * Données mockées pour les tests des pickers référentiel.
 *
 * Volontairement minimales et déterministes — pas de Faker, pas
 * d'appels réseau. Les UUIDs suivent le format `1111-…` / `2222-…`
 * pour rester lisibles dans les snapshots et messages d'erreur.
 *
 * Utilisation typique :
 *   ```ts
 *   const fetchMock = jest.fn().mockImplementation((url: string) =>
 *     ok(mockReferentialResponse(url))
 *   );
 *   global.fetch = fetchMock;
 *   ```
 */

import type {
  Donor,
  Grant,
  GrantDashboard,
  Project,
  Supplier,
} from '@/lib/api/referential';

/**
 * Génère un UUID v4-like déterministe : seul le dernier groupe encode
 * l'index `n` en hex. Suffit pour la traçabilité dans les assertions
 * (ex: "00000000-0000-0000-0000-00000000000b" pour n=11).
 */
const ID = (n: number) => {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-0000-0000-${hex}`;
};

export const mockProjects: Project[] = [
  {
    id: ID(1),
    code: 'MADIBA-VAC-2024',
    title: 'Vaccine accelerator Madiba 2024',
    programId: null,
    piUserId: null,
    startDate: '2024-01-01',
    endDate: '2026-12-31',
    status: 'active',
    description: null,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: ID(2),
    code: 'COVID-VAR-2025',
    title: 'COVID variant surveillance 2025',
    programId: null,
    piUserId: null,
    startDate: '2025-03-01',
    endDate: '2027-02-28',
    status: 'active',
    description: null,
    createdAt: '2025-03-01T00:00:00.000Z',
  },
  {
    id: ID(3),
    code: 'MALARIA-CHEM-2024',
    title: 'Malaria chemoprevention 2024',
    programId: null,
    piUserId: null,
    startDate: '2024-06-01',
    endDate: null,
    status: 'active',
    description: null,
    createdAt: '2024-06-01T00:00:00.000Z',
  },
];

export const mockGrants: Grant[] = [
  {
    id: ID(11),
    reference: 'BMGF-2023-117',
    donorId: ID(91),
    projectId: ID(1),
    amount: '485000.00',
    currency: 'USD',
    overheadRate: '0.1500',
    startDate: '2024-01-01',
    endDate: '2026-12-31',
    status: 'active',
    signedAt: '2023-12-15',
    notes: null,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: ID(12),
    reference: 'WELLCOME-MV-2024',
    donorId: ID(92),
    projectId: ID(1),
    amount: '320000.00',
    currency: 'EUR',
    overheadRate: '0.1200',
    startDate: '2024-04-01',
    endDate: '2025-12-31',
    status: 'active',
    signedAt: '2024-03-01',
    notes: null,
    createdAt: '2024-04-01T00:00:00.000Z',
  },
  {
    id: ID(21),
    reference: 'PHC-COVID-2025',
    donorId: ID(91),
    projectId: ID(2),
    amount: '750000.00',
    currency: 'USD',
    overheadRate: '0.1500',
    startDate: '2025-03-01',
    endDate: '2027-02-28',
    status: 'active',
    signedAt: '2025-02-01',
    notes: null,
    createdAt: '2025-03-01T00:00:00.000Z',
  },
];

export const mockGrantDashboards: Record<string, GrantDashboard> = {
  [ID(11)]: {
    grantRef: 'BMGF-2023-117',
    totalBudgeted: 485000,
    totalEngaged: 120000,
    totalConsumed: 80000,
    totalAvailable: 285000,
    utilization: 0.412,
    monthsRemaining: 19,
    alerts: [],
    byBudgetLine: [
      {
        budgetLineId: ID(31),
        code: 'L01',
        label: 'Consommables',
        budgeted: 200000,
        engaged: 50000,
        consumed: 30000,
        available: 120000, // 60% disponible → vert
        utilization: 0.4,
      },
      {
        budgetLineId: ID(32),
        code: 'L02',
        label: 'Équipement',
        budgeted: 150000,
        engaged: 60000,
        consumed: 50000,
        available: 40000, // 26% disponible → vert
        utilization: 0.733,
      },
      {
        budgetLineId: ID(33),
        code: 'L03',
        label: 'Frais de personnel',
        budgeted: 100000,
        engaged: 10000,
        consumed: 0,
        available: 90000, // 90% disponible → vert
        utilization: 0.1,
      },
      {
        budgetLineId: ID(34),
        code: 'L04',
        label: 'Voyage / Mission',
        budgeted: 35000,
        engaged: 30000,
        consumed: 3000,
        available: 2000, // ~5.7% disponible → orange
        utilization: 0.943,
      },
    ],
  },
  [ID(12)]: {
    grantRef: 'WELLCOME-MV-2024',
    totalBudgeted: 320000,
    totalEngaged: 280000,
    totalConsumed: 30000,
    totalAvailable: 10000,
    utilization: 0.969,
    monthsRemaining: 8,
    alerts: ['Ligne L01 à 97% utilisé'],
    byBudgetLine: [
      {
        budgetLineId: ID(41),
        code: 'L01',
        label: 'Consommables',
        budgeted: 200000,
        engaged: 198000,
        consumed: 0,
        available: 2000, // 1% → rouge
        utilization: 0.99,
      },
    ],
  },
};

export const mockSuppliers: Supplier[] = [
  {
    id: ID(51),
    code: 'THERMO_FISHER',
    name: 'Thermo Fisher Scientific',
    vatNumber: 'FR12345678901',
    address: '15 rue de la Science, Paris',
    country: 'FR',
    iban: 'FR7630006000011234567890189',
    bic: 'AGRIFRPP',
    bankName: 'Crédit Agricole',
    paymentTermsDays: 30,
    currencyDefault: 'EUR',
    riskScore: 15,
    isActive: true,
    createdAt: '2024-01-15T00:00:00.000Z',
  },
  {
    id: ID(52),
    code: 'MERCK_SN',
    name: 'Merck Sénégal',
    vatNumber: null,
    address: 'Dakar',
    country: 'SN',
    iban: 'SN082S00100100100000001',
    bic: 'SNECTRO1',
    bankName: 'CBAO',
    paymentTermsDays: 45,
    currencyDefault: 'XOF',
    riskScore: null,
    isActive: true,
    createdAt: '2024-02-01T00:00:00.000Z',
  },
  {
    id: ID(53),
    code: 'BIO_RAD',
    name: 'Bio-Rad Laboratories',
    vatNumber: null,
    address: null,
    country: 'US',
    iban: null, // RIB manquant
    bic: null,
    bankName: null,
    paymentTermsDays: 30,
    currencyDefault: 'USD',
    riskScore: 25,
    isActive: true,
    createdAt: '2024-03-01T00:00:00.000Z',
  },
];

// =====================================================================
//  Helpers de réponse fetch
// =====================================================================

export function listResponse<T>(items: T[]) {
  return {
    data: items,
    total: items.length,
    page: 1,
    pageSize: 100,
    hasMore: false,
  };
}

/**
 * Construit une réponse fetch mockée selon l'URL. Pratique pour
 * `fetchMock.mockImplementation((url) => ok(routeReferentialUrl(url)))`.
 */
export function routeReferentialUrl(url: string) {
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];

  if (path === '/api/v1/projects' || path === '/projects') {
    return listResponse(mockProjects);
  }

  if (path === '/api/v1/grants' || path === '/grants') {
    // Filter par projectId si présent
    const projectIdMatch = url.match(/projectId=([^&]+)/);
    if (projectIdMatch) {
      const pid = decodeURIComponent(projectIdMatch[1]);
      return listResponse(mockGrants.filter((g) => g.projectId === pid));
    }
    return listResponse(mockGrants);
  }

  const dashMatch = path.match(/\/grants\/([^/]+)\/dashboard$/);
  if (dashMatch) {
    const grantId = dashMatch[1];
    return mockGrantDashboards[grantId] ?? {
      grantRef: 'unknown',
      totalBudgeted: 0,
      totalEngaged: 0,
      totalConsumed: 0,
      totalAvailable: 0,
      utilization: 0,
      monthsRemaining: 0,
      alerts: [],
      byBudgetLine: [],
    };
  }

  if (path === '/api/v1/suppliers' || path === '/suppliers') {
    const qMatch = url.match(/[?&]q=([^&]+)/);
    if (qMatch) {
      const q = decodeURIComponent(qMatch[1]).toLowerCase();
      return listResponse(
        mockSuppliers.filter(
          (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q),
        ),
      );
    }
    return listResponse(mockSuppliers);
  }

  // Sprint F-REF-BAILLEURS-PROJETS — bailleurs
  if (path === '/api/v1/donors' || path === '/donors') {
    const qMatch = url.match(/[?&]q=([^&]+)/);
    if (qMatch) {
      const q = decodeURIComponent(qMatch[1]).toLowerCase();
      return listResponse(
        mockDonors.filter(
          (d) => d.code.toLowerCase().includes(q) || d.label.toLowerCase().includes(q),
        ),
      );
    }
    return listResponse(mockDonors);
  }

  return listResponse([]);
}

/** Bailleurs mockés (sprint F-REF-BAILLEURS-PROJETS). */
export const mockDonors: Donor[] = [
  {
    id: ID(101),
    code: 'BMGF',
    label: 'Bill & Melinda Gates Foundation',
    type: 'private_foundation',
    country: 'US',
    isActive: true,
  },
  {
    id: ID(102),
    code: 'EDCTP',
    label: 'European & Developing Countries Clinical Trials Partnership',
    type: 'public_intl',
    country: 'NL',
    isActive: true,
  },
];

/** Sucre : `ok(body)` → réponse fetch 200 application/json. */
export function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (k: string) => (k === 'content-type' ? 'application/json' : null),
    },
    json: async () => body,
    text: async () => '',
  };
}

/** Helper pour installer un mock fetch standard sur global.fetch. */
export function installReferentialFetchMock() {
  const fetchMock = jest.fn().mockImplementation((url: unknown) =>
    Promise.resolve(ok(routeReferentialUrl(String(url)))),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}
