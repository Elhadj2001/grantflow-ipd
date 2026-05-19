import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SepaPreview } from '../SepaPreview';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Document>
  <CstmrCdtTrfInitn>
    <GrpHdr><MsgId>PAY-2026-0001</MsgId></GrpHdr>
  </CstmrCdtTrfInitn>
</Document>`;

describe('SepaPreview', () => {
  it('renders XML in pre block + runNumber header', () => {
    render(<SepaPreview xml={SAMPLE_XML} runNumber="PAY-2026-0001" />);
    expect(screen.getByTestId('sepa-preview')).toBeInTheDocument();
    expect(screen.getByTestId('sepa-preview-xml')).toHaveTextContent(/MsgId/);
    expect(screen.getByText('PAY-2026-0001')).toBeInTheDocument();
  });

  it('shows download button when onDownload provided', async () => {
    const onDownload = jest.fn();
    const user = userEvent.setup();
    render(
      <SepaPreview xml={SAMPLE_XML} runNumber="PAY-X" onDownload={onDownload} />,
    );
    const btn = screen.getByTestId('sepa-download-btn');
    await user.click(btn);
    expect(onDownload).toHaveBeenCalled();
  });

  it('hides download button when callback not provided', () => {
    render(<SepaPreview xml={SAMPLE_XML} runNumber="PAY-X" />);
    expect(screen.queryByTestId('sepa-download-btn')).toBeNull();
  });

  it('shows "Marquer comme envoyé" only when not sent yet', async () => {
    const onMarkSent = jest.fn();
    const user = userEvent.setup();
    render(
      <SepaPreview xml={SAMPLE_XML} runNumber="PAY-X" onMarkSent={onMarkSent} />,
    );
    const btn = screen.getByTestId('sepa-mark-sent-btn');
    await user.click(btn);
    expect(onMarkSent).toHaveBeenCalled();
  });

  it('hides "Marquer envoyé" button when sentAt is set, shows date instead', () => {
    render(
      <SepaPreview
        xml={SAMPLE_XML}
        runNumber="PAY-X"
        onMarkSent={jest.fn()}
        sentAt="2026-05-20T10:00:00.000Z"
      />,
    );
    expect(screen.queryByTestId('sepa-mark-sent-btn')).toBeNull();
    expect(screen.getByTestId('sepa-sent-mark')).toHaveTextContent(/2026-05-20/);
  });

  it('disables buttons when loading', () => {
    render(
      <SepaPreview
        xml={SAMPLE_XML}
        runNumber="PAY-X"
        onDownload={jest.fn()}
        onMarkSent={jest.fn()}
        loading
      />,
    );
    expect(screen.getByTestId('sepa-download-btn')).toBeDisabled();
    expect(screen.getByTestId('sepa-mark-sent-btn')).toBeDisabled();
  });
});
