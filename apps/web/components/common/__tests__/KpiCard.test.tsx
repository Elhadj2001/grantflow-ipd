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
});
