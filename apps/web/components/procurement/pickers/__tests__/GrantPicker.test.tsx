import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GrantPicker } from '../GrantPicker';
import { installReferentialFetchMock, mockGrants, mockProjects } from '@/tests/mocks/referential';
import { renderWithQuery } from '@/tests/mocks/test-utils';

jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { accessToken: 'test-token', expires: '2099' },
    status: 'authenticated',
  }),
}));
jest.mock('@/hooks/use-toast', () => ({ toast: jest.fn() }));

describe('GrantPicker', () => {
  beforeEach(() => {
    installReferentialFetchMock();
  });

  it('is disabled when projectId is null', () => {
    renderWithQuery(<GrantPicker projectId={null} value={null} onChange={jest.fn()} />);
    expect(screen.getByTestId('grant-picker')).toBeDisabled();
    expect(screen.getByTestId('grant-picker')).toHaveTextContent(/Choisir un projet/);
  });

  it('loads only grants of the given project', async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <GrantPicker projectId={mockProjects[0].id} value={null} onChange={jest.fn()} />,
    );
    await user.click(screen.getByTestId('grant-picker'));
    // projet 1 a 2 grants (BMGF + WELLCOME)
    await waitFor(() => {
      expect(screen.getByText('BMGF-2023-117')).toBeInTheDocument();
    });
    expect(screen.getByText('WELLCOME-MV-2024')).toBeInTheDocument();
    // projet 2 a PHC-COVID — ne doit pas apparaître ici
    expect(screen.queryByText('PHC-COVID-2025')).toBeNull();
  });

  it('auto-clears value when projectId changes', async () => {
    const onChange = jest.fn();
    const { rerender, qc } = renderWithQuery(
      <GrantPicker
        projectId={mockProjects[0].id}
        value={mockGrants[0].id}
        onChange={onChange}
      />,
    );
    rerender(
      <GrantPicker projectId={mockProjects[1].id} value={mockGrants[0].id} onChange={onChange} />,
    );
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(null, null);
    });
    qc.clear();
  });

  it('emits the selected grant with its currency', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    renderWithQuery(
      <GrantPicker projectId={mockProjects[0].id} value={null} onChange={onChange} />,
    );
    await user.click(screen.getByTestId('grant-picker'));
    await user.click(await screen.findByText('BMGF-2023-117'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [id, grant] = onChange.mock.calls.at(-1)!;
    expect(id).toBe(mockGrants[0].id);
    expect(grant?.currency).toBe('USD');
  });
});
