/**
 * Sprint F-REF-BAILLEURS-PROJETS — tests RTL DonorPicker.
 *
 * Mêmes patterns que ProjectPicker.test.tsx :
 *   - mock fetch via installReferentialFetchMock + mockDonors
 *   - vérifie le rendu du trigger + le chargement des options
 *   - vérifie onChange à la sélection
 *   - vérifie autoSelectSingle = true par défaut
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DonorPicker } from '../DonorPicker';
import { installReferentialFetchMock, mockDonors } from '@/tests/mocks/referential';
import { renderWithQuery } from '@/tests/mocks/test-utils';

jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { accessToken: 'test-token', expires: '2099' },
    status: 'authenticated',
  }),
}));
jest.mock('@/hooks/use-toast', () => ({ toast: jest.fn() }));

describe('DonorPicker', () => {
  beforeEach(() => {
    installReferentialFetchMock();
  });

  it('rend le trigger + charge les options bailleurs', async () => {
    const onChange = jest.fn();
    renderWithQuery(
      <DonorPicker value={null} onChange={onChange} autoSelectSingle={false} />,
    );
    const trigger = await screen.findByTestId('donor-picker');
    expect(trigger).toHaveTextContent(/Sélectionner un bailleur/);

    await userEvent.setup().click(trigger);
    await waitFor(() => {
      expect(screen.getByText(/BMGF/)).toBeInTheDocument();
    });
    expect(screen.getByText(/EDCTP/)).toBeInTheDocument();
  });

  it('sélectionne un bailleur et émet onChange avec le donor', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    renderWithQuery(
      <DonorPicker value={null} onChange={onChange} autoSelectSingle={false} />,
    );
    await user.click(await screen.findByTestId('donor-picker'));
    await user.click(await screen.findByText(/EDCTP/));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [id, donor] = onChange.mock.calls.at(-1)!;
    expect(id).toBe(mockDonors[1].id);
    expect(donor?.code).toBe('EDCTP');
  });

  it('autoSelectSingle présélectionne quand un seul bailleur', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({
        data: [mockDonors[0]],
        total: 1,
        page: 1,
        pageSize: 100,
        hasMore: false,
      }),
      text: async () => '',
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const onChange = jest.fn();
    renderWithQuery(<DonorPicker value={null} onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][0]).toBe(mockDonors[0].id);
  });
});
