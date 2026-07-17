import { render, screen } from '@testing-library/react';
import { ApiError } from '@/lib/api-client';
import {
  ELIGIBILITY_ERROR_CODE,
  EligibilityErrorAlert,
  isEligibilityError,
} from '../EligibilityErrorAlert';

function eligibilityError(blockedCodes: string[]) {
  return new ApiError(400, {
    code: ELIGIBILITY_ERROR_CODE,
    message:
      "Demande d'achat refusée par 1 règle(s) d'éligibilité : ELIG_NATURE_NOT_ALLOWED (Nature exclue par la Note Technique)",
    details: { prId: 'pr-1', blockedCodes },
  });
}

describe('EligibilityErrorAlert (US-064)', () => {
  it('isEligibilityError discrimine sur le code métier', () => {
    expect(isEligibilityError(eligibilityError(['ELIG_NATURE_NOT_ALLOWED']))).toBe(true);
    expect(isEligibilityError(new ApiError(400, { code: 'BUSINESS.OTHER' }))).toBe(false);
    expect(isEligibilityError(null)).toBe(false);
  });

  it('affiche un libellé FR lisible par code PPT bloquant (pas un toast générique)', () => {
    render(<EligibilityErrorAlert error={eligibilityError(['ELIG_NATURE_NOT_ALLOWED'])} />);
    expect(screen.getByTestId('eligibility-error')).toBeInTheDocument();
    expect(
      screen.getByText(/Soumission refusée par le contrôle d'éligibilité/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('eligibility-error-ELIG_NATURE_NOT_ALLOWED')).toHaveTextContent(
      'Nature de dépense non autorisée par la convention',
    );
    // Le message serveur complet reste visible (détail par règle).
    expect(screen.getByText(/Nature exclue par la Note Technique/)).toBeInTheDocument();
  });

  it('liste plusieurs codes bloquants et retombe sur le code brut si inconnu', () => {
    render(
      <EligibilityErrorAlert
        error={eligibilityError(['ELIG_PERIOD_CLOSED', 'ELIG_FUTURE_RULE'])}
      />,
    );
    expect(screen.getByTestId('eligibility-error-ELIG_PERIOD_CLOSED')).toHaveTextContent(
      'Période fiscale close',
    );
    expect(screen.getByTestId('eligibility-error-ELIG_FUTURE_RULE')).toHaveTextContent(
      'ELIG_FUTURE_RULE',
    );
  });
});
