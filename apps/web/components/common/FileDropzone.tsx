'use client';

import * as React from 'react';
import { Upload, X, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface FileDropzoneProps {
  /** MIME types acceptés (ex: ['application/pdf']). */
  accept?: string[];
  /** Taille max en octets. */
  maxBytes?: number;
  /** Fichier sélectionné (controlled). */
  value: File | null;
  onChange: (file: File | null) => void;
  /** Message d'erreur custom (validation côté parent). */
  errorMessage?: string | null;
  disabled?: boolean;
  className?: string;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Zone drag-and-drop pour un fichier unique. Valide MIME + taille
 * en amont — le parent reste responsable de la soumission réseau et
 * de l'affichage des erreurs serveur.
 *
 * Sprint F3 : utilisée pour l'upload de factures PDF.
 */
export function FileDropzone({
  accept = ['application/pdf'],
  maxBytes = DEFAULT_MAX_BYTES,
  value,
  onChange,
  errorMessage,
  disabled,
  className,
}: FileDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);

  const validate = (file: File): string | null => {
    if (accept.length > 0 && !accept.includes(file.type)) {
      return `Type non supporté (${file.type || 'inconnu'}). Attendu : ${accept.join(', ')}.`;
    }
    if (file.size > maxBytes) {
      return `Fichier trop volumineux (${formatBytes(file.size)}). Maximum : ${formatBytes(maxBytes)}.`;
    }
    return null;
  };

  const handleFile = (file: File | null) => {
    setLocalError(null);
    if (!file) {
      onChange(null);
      return;
    }
    const err = validate(file);
    if (err) {
      setLocalError(err);
      onChange(null);
      return;
    }
    onChange(file);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFile(e.target.files?.[0] ?? null);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDrag(false);
    if (disabled) return;
    handleFile(e.dataTransfer.files?.[0] ?? null);
  };

  const displayError = errorMessage ?? localError;

  return (
    <div className={className}>
      <div
        data-testid="file-dropzone"
        data-drag={drag ? 'true' : undefined}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!disabled) setDrag(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={cn(
          'flex h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-center transition-colors',
          drag
            ? 'border-ipd-dark bg-ipd-50 text-ipd-darker'
            : 'border-slate-200 bg-slate-50 text-slate-muted hover:border-ipd-dark hover:text-ipd-darker',
          disabled && 'cursor-not-allowed opacity-60',
          displayError && 'border-state-error',
        )}
      >
        {value ? (
          <div className="flex items-center gap-3 px-4">
            <FileText className="h-8 w-8 text-ipd-darker" />
            <div className="text-left">
              <p
                data-testid="file-dropzone-name"
                className="font-medium text-slate-text"
              >
                {value.name}
              </p>
              <p className="text-xs text-slate-muted">{formatBytes(value.size)}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Retirer le fichier"
              onClick={(e) => {
                e.stopPropagation();
                handleFile(null);
              }}
              disabled={disabled}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            <Upload className="h-8 w-8" />
            <p className="text-sm font-medium">
              Glissez votre fichier ici ou cliquez pour parcourir
            </p>
            <p className="text-xs">
              {accept.map((m) => m.split('/')[1]?.toUpperCase()).join(', ')} — max{' '}
              {formatBytes(maxBytes)}
            </p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept.join(',')}
          onChange={onInputChange}
          disabled={disabled}
          className="hidden"
          data-testid="file-dropzone-input"
        />
      </div>
      {displayError && (
        <p
          role="alert"
          data-testid="file-dropzone-error"
          className="mt-2 text-xs font-medium text-state-error"
        >
          {displayError}
        </p>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}
