'use client';

import * as React from 'react';
import { Keyboard, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface BarcodeQuickInputProps {
  /** Callback déclenché à la soumission (Enter ou bouton). */
  onSubmit: (raw: string) => void;
  /** Auto-focus à l'affichage (utile pour scanner USB type Honeywell qui
   *  émule un clavier — il "tape" le code + Enter automatiquement). */
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * Fallback clavier au scanner webcam : un champ texte qui accepte un
 * code-barres tapé ou émis par un lecteur USB (en mode clavier HID).
 * Submit sur Enter (comportement attendu des douchettes USB).
 *
 * Réutilisé sur :
 *  - /reception-rapide (si webcam KO)
 *  - /inventaire-scan  (saisie directe d'un GR-LINE-ID connu)
 */
export function BarcodeQuickInput({
  onSubmit,
  autoFocus = true,
  placeholder = 'Scannez ou saisissez le code',
  className,
}: BarcodeQuickInputProps) {
  const [value, setValue] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue('');
    // Refocus pour le scan suivant (mode douchette enchaîne)
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div
      data-testid="barcode-quick-input"
      className={`flex items-end gap-2 ${className ?? ''}`}
    >
      <div className="flex-1">
        <Label htmlFor="barcode-quick" className="mb-1 flex items-center gap-1 text-xs uppercase tracking-wide text-slate-muted">
          <Keyboard className="h-3 w-3" /> Saisie clavier / douchette USB
        </Label>
        <Input
          ref={inputRef}
          id="barcode-quick"
          data-testid="barcode-quick-field"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          className="min-h-12 font-mono text-sm"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <Button
        type="button"
        onClick={submit}
        disabled={!value.trim()}
        className="min-h-12"
        data-testid="barcode-quick-submit"
      >
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
