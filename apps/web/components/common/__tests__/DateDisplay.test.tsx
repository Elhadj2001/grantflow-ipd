import { render, screen } from '@testing-library/react';
import { DateDisplay } from '../DateDisplay';

describe('DateDisplay', () => {
  it('renders em-dash for null', () => {
    const { container } = render(<DateDisplay value={null} />);
    expect(container.textContent).toBe('—');
  });

  it('renders em-dash for invalid date string', () => {
    const { container } = render(<DateDisplay value="not-a-date" />);
    expect(container.textContent).toBe('—');
  });

  it('renders long format by default (17 mai 2026)', () => {
    const { container } = render(<DateDisplay value="2026-05-17" />);
    expect(container.textContent).toMatch(/17 mai 2026/);
  });

  it('renders short format DD/MM/YYYY', () => {
    const { container } = render(<DateDisplay value="2026-05-17" format="short" />);
    expect(container.textContent).toMatch(/17\/05\/2026/);
  });

  it('renders datetime format with hh:mm', () => {
    const { container } = render(<DateDisplay value="2026-05-17T10:30:00Z" format="datetime" />);
    // L'heure peut varier selon le fuseau du test runner — on vérifie juste la présence d'un séparateur date+heure
    expect(container.textContent).toMatch(/2026/);
    expect(container.textContent).toMatch(/:/);
  });

  it('adds relative time when relative=true', () => {
    const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString();
    render(<DateDisplay value={oneDayAgo} relative />);
    // "il y a 1 jour" ou "hier" selon Intl
    expect(screen.getByRole('time').textContent ?? '').toMatch(/jour|hier/i);
  });

  it('sets dateTime attribute (ISO) on <time>', () => {
    render(<DateDisplay value="2026-05-17" />);
    expect(screen.getByRole('time')).toHaveAttribute('dateTime', expect.stringContaining('2026'));
  });
});
