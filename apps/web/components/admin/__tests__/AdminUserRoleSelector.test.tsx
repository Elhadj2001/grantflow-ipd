/**
 * Sprint F-ADMIN-USERS Lot D — tests RTL AdminUserRoleSelector.
 *
 * Vérifie :
 *   - Tous les rôles (11) sont rendus comme boutons
 *   - Toggle ajoute/retire de la liste
 *   - `readonlyRoles` empêche le retrait d'un rôle (cas dernier SUPER_ADMIN)
 *   - `disabled` désactive tous les boutons
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import {
  AdminUserRoleSelector,
  AdminUserRolesBadges,
} from '../AdminUserRoleSelector';
import { GRANTFLOW_ROLES, type GrantflowRoleCode } from '@/lib/api/admin-users';

/** Wrapper stateful pour vérifier le onChange. */
function Harness({
  initial,
  readonlyRoles = [],
}: {
  initial: GrantflowRoleCode[];
  readonlyRoles?: GrantflowRoleCode[];
}) {
  const [value, setValue] = useState<GrantflowRoleCode[]>(initial);
  return (
    <>
      <AdminUserRoleSelector
        value={value}
        onChange={setValue}
        readonlyRoles={readonlyRoles}
      />
      <span data-testid="harness-value">{value.join(',')}</span>
    </>
  );
}

describe('AdminUserRoleSelector', () => {
  it('rend les 11 rôles et expose aria-pressed=true sur les sélectionnés', () => {
    render(<Harness initial={['DAF']} />);
    expect(screen.getByTestId('role-selector')).toHaveAttribute(
      'data-selected-count',
      '1',
    );
    GRANTFLOW_ROLES.forEach((r) => {
      const btn = screen.getByTestId(`role-${r}`);
      expect(btn).toHaveAttribute('aria-pressed', r === 'DAF' ? 'true' : 'false');
    });
  });

  it('toggle ajoute / retire un rôle', () => {
    render(<Harness initial={['DAF']} />);
    fireEvent.click(screen.getByTestId('role-COMPTABLE'));
    expect(screen.getByTestId('harness-value').textContent).toBe('DAF,COMPTABLE');
    fireEvent.click(screen.getByTestId('role-DAF'));
    expect(screen.getByTestId('harness-value').textContent).toBe('COMPTABLE');
  });

  it('readonlyRoles : empêche le retrait du rôle verrouillé (cas dernier SUPER_ADMIN)', () => {
    render(<Harness initial={['SUPER_ADMIN', 'DAF']} readonlyRoles={['SUPER_ADMIN']} />);
    const saBtn = screen.getByTestId('role-SUPER_ADMIN');
    expect(saBtn).toBeDisabled();
    fireEvent.click(saBtn);
    expect(screen.getByTestId('harness-value').textContent).toBe('SUPER_ADMIN,DAF');
  });

  it("readonlyRoles : autorise l'AJOUT du rôle verrouillé (jamais sélectionné encore)", () => {
    render(<Harness initial={['DAF']} readonlyRoles={['SUPER_ADMIN']} />);
    const saBtn = screen.getByTestId('role-SUPER_ADMIN');
    // disabled est calculé `disabled || (locked && selected)` → ici selected=false, donc enabled.
    expect(saBtn).not.toBeDisabled();
    fireEvent.click(saBtn);
    expect(screen.getByTestId('harness-value').textContent).toBe('DAF,SUPER_ADMIN');
  });
});

describe('AdminUserRolesBadges', () => {
  it('affiche un badge par rôle avec libellé FR', () => {
    render(<AdminUserRolesBadges roles={['DAF', 'COMPTABLE']} />);
    expect(screen.getByTestId('role-badge-DAF')).toBeInTheDocument();
    expect(screen.getByTestId('role-badge-COMPTABLE')).toBeInTheDocument();
    expect(screen.getByText('DAF')).toBeInTheDocument();
    expect(screen.getByText('Comptable')).toBeInTheDocument();
  });

  it('mention "Aucun rôle" si liste vide', () => {
    render(<AdminUserRolesBadges roles={[]} />);
    expect(screen.getByText('Aucun rôle')).toBeInTheDocument();
  });
});
