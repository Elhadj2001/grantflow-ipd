import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { FileDropzone } from '../FileDropzone';

function Harness({
  maxBytes = 10 * 1024 * 1024,
  accept = ['application/pdf'],
}: {
  maxBytes?: number;
  accept?: string[];
}) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <FileDropzone
      value={file}
      onChange={setFile}
      maxBytes={maxBytes}
      accept={accept}
    />
  );
}

function makeFile(name: string, size: number, type: string): File {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

describe('FileDropzone', () => {
  it('renders empty dropzone with hint', () => {
    render(<Harness />);
    expect(screen.getByTestId('file-dropzone')).toBeInTheDocument();
    expect(screen.getByText(/Glissez votre fichier ici/)).toBeInTheDocument();
  });

  it('accepts a valid PDF via input change', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByTestId('file-dropzone-input') as HTMLInputElement;
    const file = makeFile('invoice.pdf', 1024, 'application/pdf');
    await user.upload(input, file);
    expect(screen.getByTestId('file-dropzone-name')).toHaveTextContent('invoice.pdf');
  });

  it('rejects non-PDF MIME with error message', () => {
    render(<Harness />);
    const input = screen.getByTestId('file-dropzone-input') as HTMLInputElement;
    const png = makeFile('photo.png', 1024, 'image/png');
    // fireEvent direct car userEvent.upload filtre selon l'attribut accept
    Object.defineProperty(input, 'files', { value: [png], configurable: true });
    fireEvent.change(input);
    expect(screen.getByTestId('file-dropzone-error')).toHaveTextContent(/Type non supporté/);
    expect(screen.queryByTestId('file-dropzone-name')).toBeNull();
  });

  it('rejects file too large', async () => {
    const user = userEvent.setup();
    render(<Harness maxBytes={1024} />);
    const input = screen.getByTestId('file-dropzone-input') as HTMLInputElement;
    const big = makeFile('huge.pdf', 5000, 'application/pdf');
    await user.upload(input, big);
    expect(screen.getByTestId('file-dropzone-error')).toHaveTextContent(/trop volumineux/);
  });

  it('allows removing a selected file', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByTestId('file-dropzone-input') as HTMLInputElement;
    await user.upload(input, makeFile('a.pdf', 100, 'application/pdf'));
    expect(screen.getByTestId('file-dropzone-name')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Retirer le fichier'));
    expect(screen.queryByTestId('file-dropzone-name')).toBeNull();
    expect(screen.getByText(/Glissez votre fichier/)).toBeInTheDocument();
  });

  it('handles drag-and-drop of valid file', () => {
    render(<Harness />);
    const zone = screen.getByTestId('file-dropzone');
    const file = makeFile('drop.pdf', 200, 'application/pdf');
    fireEvent.dragEnter(zone, { dataTransfer: { files: [file] } });
    expect(zone).toHaveAttribute('data-drag', 'true');
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(screen.getByTestId('file-dropzone-name')).toHaveTextContent('drop.pdf');
  });
});
