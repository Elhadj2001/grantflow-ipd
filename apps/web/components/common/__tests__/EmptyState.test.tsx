import { render, screen, fireEvent } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('renders icon + title + description', () => {
    render(
      <EmptyState
        icon={Inbox}
        title="Pas encore d'activité"
        description="Les actions apparaîtront ici."
      />,
    );
    expect(screen.getByRole('heading', { name: /Pas encore d'activité/ })).toBeInTheDocument();
    expect(screen.getByText('Les actions apparaîtront ici.')).toBeInTheDocument();
  });

  it('renders action button when actionLabel passed', () => {
    const onAction = jest.fn();
    render(<EmptyState icon={Inbox} title="X" actionLabel="Recharger" onAction={onAction} />);
    const btn = screen.getByRole('button', { name: 'Recharger' });
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('disables action button when actionDisabled=true', () => {
    render(<EmptyState icon={Inbox} title="X" actionLabel="Bientôt" actionDisabled />);
    expect(screen.getByRole('button', { name: 'Bientôt' })).toBeDisabled();
  });
});
