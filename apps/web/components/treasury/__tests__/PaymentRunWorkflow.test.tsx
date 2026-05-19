import { render, screen } from '@testing-library/react';
import { PaymentRunWorkflow } from '../PaymentRunWorkflow';

describe('PaymentRunWorkflow', () => {
  it('renders 4 steps timeline for draft', () => {
    render(<PaymentRunWorkflow status="draft" />);
    const root = screen.getByTestId('payment-run-workflow');
    expect(root).toHaveAttribute('data-status', 'draft');
    expect(root).toHaveAttribute('data-current-index', '0');
    expect(screen.getByTestId('workflow-step-draft')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-step-prepared')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-step-sepa')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-step-executed')).toBeInTheDocument();
  });

  it('marks prepared step active when status=prepared (no SEPA yet)', () => {
    render(<PaymentRunWorkflow status="prepared" />);
    expect(screen.getByTestId('payment-run-workflow')).toHaveAttribute('data-current-index', '1');
  });

  it('advances to SEPA step when prepared + sepaGeneratedAt', () => {
    render(
      <PaymentRunWorkflow status="prepared" sepaGeneratedAt="2026-05-20T00:00:00.000Z" />,
    );
    expect(screen.getByTestId('payment-run-workflow')).toHaveAttribute('data-current-index', '2');
  });

  it('marks executed step done at status=executed', () => {
    render(
      <PaymentRunWorkflow
        status="executed"
        approvedAt="2026-05-20T10:00:00.000Z"
        executedAt="2026-05-20T11:00:00.000Z"
      />,
    );
    expect(screen.getByTestId('payment-run-workflow')).toHaveAttribute('data-current-index', '3');
  });

  it('shows rejected banner instead of timeline', () => {
    render(<PaymentRunWorkflow status="rejected" />);
    const root = screen.getByTestId('payment-run-workflow');
    expect(root).toHaveAttribute('data-status', 'rejected');
    expect(root).toHaveTextContent(/Rejeté par le DAF/);
    expect(screen.queryByTestId('workflow-step-draft')).toBeNull();
  });

  it('shows cancelled banner instead of timeline', () => {
    render(<PaymentRunWorkflow status="cancelled" />);
    expect(screen.getByTestId('payment-run-workflow')).toHaveTextContent(/Annulé/);
  });
});
