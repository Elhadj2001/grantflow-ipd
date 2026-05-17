import { render, screen } from '@testing-library/react';
import { FilePlus } from 'lucide-react';
import { ShortcutCard } from '../ShortcutCard';

describe('ShortcutCard', () => {
  it('renders title + description', () => {
    render(<ShortcutCard icon={FilePlus} title="Créer une DA" description="Saisir une DA" />);
    expect(screen.getByRole('heading', { name: 'Créer une DA' })).toBeInTheDocument();
    expect(screen.getByText('Saisir une DA')).toBeInTheDocument();
  });

  it('defaults to disabled with "Bientôt disponible" action', () => {
    render(<ShortcutCard icon={FilePlus} title="X" description="Y" />);
    const btn = screen.getByRole('button', { name: 'Bientôt disponible' });
    expect(btn).toBeDisabled();
    expect(screen.getByTestId('shortcut-card')).toHaveAttribute('data-disabled', 'true');
  });

  it('can be enabled with custom actionLabel', () => {
    render(
      <ShortcutCard
        icon={FilePlus}
        title="X"
        description="Y"
        actionLabel="Y aller"
        disabled={false}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Y aller' });
    expect(btn).not.toBeDisabled();
    expect(screen.getByTestId('shortcut-card')).toHaveAttribute('data-disabled', 'false');
  });
});
