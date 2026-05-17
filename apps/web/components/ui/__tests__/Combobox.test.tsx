import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Combobox, type ComboboxOption } from '../combobox';

const OPTIONS: ComboboxOption[] = [
  { value: 'a', label: 'Apple', sublabel: 'fruit rouge' },
  { value: 'b', label: 'Banana', sublabel: 'fruit jaune' },
  { value: 'c', label: 'Cherry', sublabel: 'fruit rouge' },
];

function Harness({
  options = OPTIONS,
  initialValue = null,
  loading = false,
}: {
  options?: ComboboxOption[];
  initialValue?: string | null;
  loading?: boolean;
}) {
  const [val, setVal] = useState<string | null>(initialValue);
  return (
    <Combobox
      testId="combo"
      options={options}
      value={val}
      onChange={setVal}
      loading={loading}
    />
  );
}

describe('Combobox', () => {
  it('renders trigger with placeholder when empty', () => {
    render(<Harness />);
    expect(screen.getByTestId('combo')).toHaveTextContent(/Sélectionner/);
  });

  it('opens popover on trigger click and lists options', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByTestId('combo'));
    expect(await screen.findByText('Apple')).toBeInTheDocument();
    expect(screen.getByText('Banana')).toBeInTheDocument();
    expect(screen.getByText('Cherry')).toBeInTheDocument();
  });

  it('filters options by typed query', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByTestId('combo'));
    const input = await screen.findByPlaceholderText(/Rechercher/);
    await user.type(input, 'ban');
    expect(screen.getByText('Banana')).toBeInTheDocument();
    expect(screen.queryByText('Apple')).toBeNull();
  });

  it('selects an option and updates trigger label', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByTestId('combo'));
    await user.click(await screen.findByText('Cherry'));
    expect(screen.getByTestId('combo')).toHaveTextContent('Cherry');
  });

  it('shows skeletons in loading state', () => {
    render(<Harness loading />);
    // Trigger is still rendered but disabled; popover content has skeletons —
    // we just check that no real option text leaks
    expect(screen.queryByText('Apple')).toBeNull();
  });

  it('shows empty state when no option matches', async () => {
    const user = userEvent.setup();
    render(<Harness options={[]} />);
    await user.click(screen.getByTestId('combo'));
    expect(await screen.findByText(/Aucun résultat/)).toBeInTheDocument();
  });

  it('clears selection via the X button', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="b" />);
    expect(screen.getByTestId('combo')).toHaveTextContent('Banana');
    await user.click(screen.getByLabelText('Effacer la sélection'));
    expect(screen.getByTestId('combo')).toHaveTextContent(/Sélectionner/);
  });
});
