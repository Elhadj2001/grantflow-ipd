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

  // -----------------------------------------------------------------
  // Sprint F-DASHBOARD — prop `href` (raccourci cliquable)
  // -----------------------------------------------------------------

  it('href fourni → carte active, lien Next.js avec href correct + label "Ouvrir"', () => {
    render(
      <ShortcutCard
        icon={FilePlus}
        title="Créer une DA"
        description="Y"
        href="/procurement/purchase-requests/new"
      />,
    );
    const link = screen.getByRole('link', { name: 'Ouvrir' });
    expect(link).toHaveAttribute('href', '/procurement/purchase-requests/new');
    const card = screen.getByTestId('shortcut-card');
    expect(card).toHaveAttribute('data-disabled', 'false');
    expect(card).toHaveAttribute('data-href', '/procurement/purchase-requests/new');
  });

  it('href absent → carte désactivée (rétro-compat F1.1)', () => {
    render(<ShortcutCard icon={FilePlus} title="X" description="Y" />);
    expect(screen.queryByRole('link')).toBeNull();
    const btn = screen.getByRole('button', { name: 'Bientôt disponible' });
    expect(btn).toBeDisabled();
    expect(screen.getByTestId('shortcut-card')).toHaveAttribute('data-href', '');
  });

  it('disabled=true override : même avec href, la carte reste désactivée', () => {
    render(
      <ShortcutCard
        icon={FilePlus}
        title="X"
        description="Y"
        href="/some/route"
        disabled
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByTestId('shortcut-card')).toHaveAttribute('data-disabled', 'true');
  });

  it('actionLabel custom est utilisé avec href', () => {
    render(
      <ShortcutCard
        icon={FilePlus}
        title="X"
        description="Y"
        href="/x"
        actionLabel="Y aller"
      />,
    );
    expect(screen.getByRole('link', { name: 'Y aller' })).toHaveAttribute('href', '/x');
  });
});
