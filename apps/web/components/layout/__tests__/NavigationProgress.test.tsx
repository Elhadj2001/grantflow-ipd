import { act, fireEvent, render, screen } from '@testing-library/react';

let mockPathname = '/dashboard';
let mockSearch = '';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

// Import APRÈS jest.mock (hoisting)
import { NavigationProgress } from '../NavigationProgress';

/**
 * Rend le composant avec un lien voisin sur lequel cliquer. preventDefault
 * en phase BULLE : évite le « Not implemented: navigation » de jsdom sans
 * fausser le test (le listener du composant est en phase CAPTURE, il
 * s'exécute avant et voit defaultPrevented=false).
 */
function renderWithLink(href: string, attrs: Record<string, string> = {}) {
  return render(
    <div>
      <NavigationProgress />
      <a href={href} {...attrs} data-testid="lien" onClick={(e) => e.preventDefault()}>
        aller
      </a>
    </div>,
  );
}

describe('NavigationProgress', () => {
  beforeEach(() => {
    mockPathname = '/dashboard';
    mockSearch = '';
    jest.useFakeTimers();
    // jsdom : window.location.pathname = '/' par défaut
    window.history.pushState({}, '', '/dashboard');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("reste invisible tant qu'aucune navigation n'est amorcée", () => {
    renderWithLink('/procurement/purchase-requests');
    expect(screen.queryByTestId('nav-progress')).not.toBeInTheDocument();
  });

  it('démarre au clic sur un lien interne vers une autre page', () => {
    renderWithLink('/procurement/purchase-requests');
    fireEvent.click(screen.getByTestId('lien'));
    const bar = screen.getByTestId('nav-progress');
    expect(bar).toHaveClass('ipd-progress-ramp');
    expect(bar).toHaveClass('bg-ipd-bleu');
  });

  it('ignore les liens externes, target=_blank et la page courante', () => {
    const { unmount } = renderWithLink('https://example.com/page');
    fireEvent.click(screen.getByTestId('lien'));
    expect(screen.queryByTestId('nav-progress')).not.toBeInTheDocument();
    unmount();

    const { unmount: unmount2 } = renderWithLink('/autre', { target: '_blank' });
    fireEvent.click(screen.getByTestId('lien'));
    expect(screen.queryByTestId('nav-progress')).not.toBeInTheDocument();
    unmount2();

    renderWithLink('/dashboard'); // même pathname que window.location
    fireEvent.click(screen.getByTestId('lien'));
    expect(screen.queryByTestId('nav-progress')).not.toBeInTheDocument();
  });

  it("passe en phase 'done' à l'arrivée de la nouvelle route puis disparaît", () => {
    const { rerender } = renderWithLink('/procurement/purchase-requests');
    fireEvent.click(screen.getByTestId('lien'));
    expect(screen.getByTestId('nav-progress')).toHaveClass('ipd-progress-ramp');

    // La route change (usePathname retourne la nouvelle valeur au re-render)
    mockPathname = '/procurement/purchase-requests';
    rerender(
      <div>
        <NavigationProgress />
        <a href="/procurement/purchase-requests" data-testid="lien">
          aller
        </a>
      </div>,
    );
    expect(screen.getByTestId('nav-progress')).toHaveClass('ipd-progress-done');

    // Après le fondu (260 ms), la barre est démontée
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.queryByTestId('nav-progress')).not.toBeInTheDocument();
  });
});
