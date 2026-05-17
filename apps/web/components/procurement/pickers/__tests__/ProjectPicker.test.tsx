import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectPicker } from '../ProjectPicker';
import { installReferentialFetchMock, mockProjects } from '@/tests/mocks/referential';
import { renderWithQuery } from '@/tests/mocks/test-utils';

jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { accessToken: 'test-token', expires: '2099' },
    status: 'authenticated',
  }),
}));
jest.mock('@/hooks/use-toast', () => ({ toast: jest.fn() }));

describe('ProjectPicker', () => {
  beforeEach(() => {
    installReferentialFetchMock();
  });

  it('renders trigger and loads project options', async () => {
    const onChange = jest.fn();
    renderWithQuery(<ProjectPicker value={null} onChange={onChange} autoSelectSingle={false} />);
    const trigger = await screen.findByTestId('project-picker');
    expect(trigger).toHaveTextContent(/Sélectionner un projet/);

    await userEvent.setup().click(trigger);
    await waitFor(() => {
      expect(screen.getByText(/MADIBA-VAC-2024/)).toBeInTheDocument();
    });
    expect(screen.getByText(/COVID-VAR-2025/)).toBeInTheDocument();
  });

  it('selects a project and emits onChange with the project object', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    renderWithQuery(<ProjectPicker value={null} onChange={onChange} autoSelectSingle={false} />);
    await user.click(await screen.findByTestId('project-picker'));
    await user.click(await screen.findByText(/COVID-VAR-2025/));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [id, proj] = onChange.mock.calls.at(-1)!;
    expect(id).toBe(mockProjects[1].id);
    expect(proj?.code).toBe('COVID-VAR-2025');
  });

  it('autoSelectSingle preselects when only one project is returned', async () => {
    // Override fetch pour ne renvoyer qu'un seul projet
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({
        data: [mockProjects[0]],
        total: 1,
        page: 1,
        pageSize: 100,
        hasMore: false,
      }),
      text: async () => '',
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const onChange = jest.fn();
    renderWithQuery(<ProjectPicker value={null} onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][0]).toBe(mockProjects[0].id);
  });
});
