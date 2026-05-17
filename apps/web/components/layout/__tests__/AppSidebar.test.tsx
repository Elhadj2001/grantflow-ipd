import { render, screen } from '@testing-library/react';
import { AppSidebar } from '../AppSidebar';

let mockPathname = '/dashboard';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

describe('AppSidebar', () => {
  it('renders the 5 navigation entries', () => {
    mockPathname = '/dashboard';
    render(<AppSidebar />);
    ['Dashboard', 'Achats', 'Comptabilité', 'Trésorerie', 'Reporting'].forEach((label) =>
      expect(screen.getByText(label)).toBeInTheDocument(),
    );
  });

  it('marks Dashboard active on /dashboard with pasteur accent', () => {
    mockPathname = '/dashboard';
    render(<AppSidebar />);
    const dashboardLink = screen.getByText('Dashboard').closest('a');
    expect(dashboardLink).toHaveAttribute('aria-current', 'page');
    expect(dashboardLink?.className).toMatch(/border-l-pasteur/);
  });

  it('disables Achats / Compta / Trésorerie / Reporting in F1', () => {
    mockPathname = '/dashboard';
    render(<AppSidebar />);
    ['Achats', 'Comptabilité', 'Trésorerie', 'Reporting'].forEach((label) => {
      const el = screen.getByText(label).closest('[aria-disabled="true"]');
      expect(el).not.toBeNull();
    });
  });

  it('does not mark Dashboard active when on a different path', () => {
    mockPathname = '/something';
    render(<AppSidebar />);
    const dashboardLink = screen.getByText('Dashboard').closest('a');
    expect(dashboardLink).not.toHaveAttribute('aria-current', 'page');
  });
});
