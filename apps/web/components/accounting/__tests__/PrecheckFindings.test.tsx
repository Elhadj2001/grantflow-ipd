import { render, screen } from '@testing-library/react';
import { PrecheckFindings } from '../PrecheckFindings';
import type { PrecheckFinding } from '@/lib/api/accounting';

const blocking: PrecheckFinding = {
  code: 'C006',
  severity: 'BLOCKING',
  message: '2 complete goods receipt(s) without an FNP posting',
  payload: { count: 2 },
};

const warning: PrecheckFinding = {
  code: 'W001',
  severity: 'WARNING',
  message: '3 budget line(s) with variance > 10%',
  payload: { lines: 3 },
};

describe('PrecheckFindings', () => {
  it('liste vide → état "période prête à clôturer"', () => {
    render(<PrecheckFindings findings={[]} />);
    expect(screen.getByTestId('precheck-clean')).toBeInTheDocument();
    expect(screen.getByText(/prête à être clôturée/i)).toBeInTheDocument();
  });

  it('loading → "Précheck en cours…"', () => {
    render(<PrecheckFindings findings={[]} loading />);
    expect(screen.getByTestId('precheck-loading')).toBeInTheDocument();
  });

  it('groupe BLOCKING + libellé FR depuis CHECK_CODE_LABELS_FR', () => {
    render(<PrecheckFindings findings={[blocking]} />);
    expect(screen.getByTestId('findings-group-BLOCKING')).toBeInTheDocument();
    expect(screen.queryByTestId('findings-group-WARNING')).toBeNull();
    expect(screen.getByTestId('finding-C006')).toHaveAttribute('data-severity', 'BLOCKING');
    expect(screen.getByText(/Réceptions complètes non comptabilisées/i)).toBeInTheDocument();
  });

  it('groupe WARNING séparé du groupe BLOCKING', () => {
    render(<PrecheckFindings findings={[blocking, warning]} />);
    expect(screen.getByTestId('findings-group-BLOCKING')).toBeInTheDocument();
    expect(screen.getByTestId('findings-group-WARNING')).toBeInTheDocument();
    expect(screen.getByTestId('finding-W001')).toBeInTheDocument();
  });

  it('count pluriel/singulier dans le titre', () => {
    render(
      <PrecheckFindings
        findings={[
          { ...blocking, code: 'C001', payload: {} },
          { ...blocking, code: 'C002', payload: {} },
        ]}
      />,
    );
    expect(screen.getByText(/2 findings bloquants/)).toBeInTheDocument();
  });
});
