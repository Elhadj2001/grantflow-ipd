import { render, screen, fireEvent } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../DataTable';
import { EmptyState } from '../EmptyState';

interface Row {
  id: string;
  name: string;
  amount: number;
}

const rows: Row[] = [
  { id: '1', name: 'Alpha', amount: 100 },
  { id: '2', name: 'Beta', amount: 250 },
];

const cols: DataTableColumn<Row>[] = [
  { key: 'name', header: 'Nom', cell: (r) => r.name, sortable: true },
  { key: 'amount', header: 'Montant', cell: (r) => r.amount, align: 'right' },
];

describe('DataTable', () => {
  it('renders headers + rows', () => {
    render(<DataTable columns={cols} data={rows} getRowId={(r) => r.id} />);
    expect(screen.getByText('Nom')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('250')).toBeInTheDocument();
  });

  it('shows skeleton rows when isLoading', () => {
    const { container } = render(
      <DataTable columns={cols} data={[]} getRowId={(r) => r.id} isLoading />,
    );
    // 5 skeleton rows × 2 cols = 10 skeletons
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(5);
  });

  it('renders empty state when isEmpty', () => {
    render(
      <DataTable
        columns={cols}
        data={[]}
        getRowId={(r) => r.id}
        isEmpty
        emptyState={<EmptyState icon={Inbox} title="Rien à voir" />}
      />,
    );
    expect(screen.getByText('Rien à voir')).toBeInTheDocument();
  });

  it('default empty state when no emptyState slot', () => {
    render(<DataTable columns={cols} data={[]} getRowId={(r) => r.id} isEmpty />);
    expect(screen.getByText('Aucun élément à afficher.')).toBeInTheDocument();
  });

  it('triggers onSort with asc when first click on sortable header', () => {
    const onSort = jest.fn();
    render(<DataTable columns={cols} data={rows} getRowId={(r) => r.id} onSort={onSort} />);
    fireEvent.click(screen.getByText('Nom'));
    expect(onSort).toHaveBeenCalledWith('name', 'asc');
  });

  it('toggles asc→desc when clicking the active sorted column', () => {
    const onSort = jest.fn();
    render(
      <DataTable
        columns={cols}
        data={rows}
        getRowId={(r) => r.id}
        onSort={onSort}
        sortState={{ key: 'name', direction: 'asc' }}
      />,
    );
    fireEvent.click(screen.getByText('Nom'));
    expect(onSort).toHaveBeenCalledWith('name', 'desc');
  });

  it('calls onRowClick when a row is clicked', () => {
    const onRowClick = jest.fn();
    render(
      <DataTable columns={cols} data={rows} getRowId={(r) => r.id} onRowClick={onRowClick} />,
    );
    fireEvent.click(screen.getByTestId('row-1'));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it('renders pagination when total > pageSize', () => {
    const onPageChange = jest.fn();
    render(
      <DataTable
        columns={cols}
        data={rows}
        getRowId={(r) => r.id}
        pagination={{ page: 1, pageSize: 2, total: 5, onPageChange }}
      />,
    );
    expect(screen.getByText(/Page 1 sur 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
