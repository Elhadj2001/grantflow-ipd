import { render, screen } from '@testing-library/react';
import { FileText } from 'lucide-react';
import { KpiCard } from '../KpiCard';

describe('KpiCard', () => {
  it('renders label, value and hint', () => {
    render(<KpiCard label="DA en attente" value="42" hint="Demandes à approuver" />);
    expect(screen.getByText('DA en attente')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Demandes à approuver')).toBeInTheDocument();
  });

  it('renders without hint', () => {
    render(<KpiCard label="Sans hint" value="—" />);
    expect(screen.getByText('Sans hint')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    const { container } = render(
      <KpiCard label="Avec icône" value="7" icon={FileText} />,
    );
    // lucide-react rend une <svg>
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('applies pasteur accent by default', () => {
    const { container } = render(<KpiCard label="X" value="1" />);
    expect(container.querySelector('.bg-pasteur')).not.toBeNull();
  });

  it('applies navy accent when passed', () => {
    const { container } = render(<KpiCard label="X" value="1" accent="navy" />);
    expect(container.querySelector('.bg-navy')).not.toBeNull();
  });

  it('renders skeleton progress bar when no progress prop', () => {
    render(<KpiCard label="X" value="1" />);
    expect(screen.getByTestId('kpi-skeleton')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveAttribute('aria-valuenow');
  });

  it('renders real progress bar with aria-valuenow when progress=42', () => {
    render(<KpiCard label="X" value="1" progress={42} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByTestId('kpi-progress')).toHaveStyle({ width: '42%' });
  });

  it('clamps progress to [0..100]', () => {
    const { rerender } = render(<KpiCard label="X" value="1" progress={150} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    rerender(<KpiCard label="X" value="1" progress={-20} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
});
