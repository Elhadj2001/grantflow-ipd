'use client';

import * as React from 'react';
import { Camera, CameraOff, Keyboard, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Composant scanner caméra plein-écran. Wrap autour de html5-qrcode :
 * délègue l'init / cleanup à l'effet, expose une API simple `onScan`.
 *
 * Pourquoi html5-qrcode :
 *   - Zero backend (getUserMedia + détection JS)
 *   - Fonctionne sur HTTPS et localhost (constraint navigateur)
 *   - Détecte QR + EAN/UPC — on filtre côté UI ce qu'on accepte
 *   - ~50 kB gzip, lib stable et maintenue
 *
 * Tests : on mocke `html5-qrcode` dans jest pour simuler les callbacks
 * de scan (jsdom n'a pas getUserMedia).
 */
export interface ScanBarcodeProps {
  /** Callback à chaque scan réussi (chaîne brute, à parser par le caller). */
  onScan: (decoded: string) => void;
  /** Ferme le scanner (X en haut à droite). */
  onClose: () => void;
  /**
   * Bascule sur la saisie manuelle (clavier). Le caller doit afficher
   * son propre BarcodeQuickInput en alternative.
   */
  onSwitchToManual?: () => void;
  /** Vibration sur scan réussi (default true). */
  hapticOnScan?: boolean;
  className?: string;
}

interface MinimalHtml5QrcodeConstructor {
  new (elementId: string): {
    start(
      cameraConfig: { facingMode: string } | { deviceId: string },
      config: { fps?: number; qrbox?: { width: number; height: number } },
      onSuccess: (decoded: string) => void,
      onError?: (msg: string) => void,
    ): Promise<void>;
    stop(): Promise<void>;
    clear(): void;
  };
}

const READER_ID = 'gr-scan-reader';

export function ScanBarcode({
  onScan,
  onClose,
  onSwitchToManual,
  hapticOnScan = true,
  className,
}: ScanBarcodeProps) {
  const [error, setError] = React.useState<string | null>(null);
  const [active, setActive] = React.useState(false);
  // On garde une ref vers l'instance pour pouvoir l'arrêter au démontage.
  const instanceRef = React.useRef<InstanceType<MinimalHtml5QrcodeConstructor> | null>(null);
  // Dernière chaîne scannée pour éviter les doublons consécutifs (la lib
  // peut firer 2-3x le même code en 100ms si on garde la cible visible).
  const lastScanRef = React.useRef<{ text: string; at: number } | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Import dynamique : évite que jest essaie de parser html5-qrcode
        // au top-level (la lib touche `document` au load).
        const mod = (await import('html5-qrcode')) as unknown as {
          Html5Qrcode: MinimalHtml5QrcodeConstructor;
        };
        if (cancelled) return;

        const instance = new mod.Html5Qrcode(READER_ID);
        instanceRef.current = instance;

        await instance.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decoded) => {
            // Dedup : ignore la même chaîne si scannée < 1500ms ago
            const last = lastScanRef.current;
            const now = Date.now();
            if (last && last.text === decoded && now - last.at < 1500) return;
            lastScanRef.current = { text: decoded, at: now };
            if (hapticOnScan && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
              try { navigator.vibrate(100); } catch { /* noop */ }
            }
            onScan(decoded);
          },
          () => {
            // Pas de spam : la lib appelle onError à chaque frame sans détection
          },
        );
        if (!cancelled) setActive(true);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : 'Impossible d\'accéder à la caméra. Vérifiez les permissions.',
        );
      }
    }

    void init();

    return () => {
      cancelled = true;
      const inst = instanceRef.current;
      if (inst) {
        inst.stop().catch(() => undefined).finally(() => {
          try { inst.clear(); } catch { /* noop */ }
        });
        instanceRef.current = null;
      }
    };
  }, [hapticOnScan, onScan]);

  return (
    <div
      data-testid="scan-barcode"
      className={cn(
        'fixed inset-0 z-50 flex flex-col bg-slate-900 text-white',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b border-slate-700 px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          {active ? (
            <>
              <Camera className="h-4 w-4 text-state-success" />
              <span>Scanner actif — centrez le QR dans le cadre</span>
            </>
          ) : (
            <>
              <CameraOff className="h-4 w-4 text-state-warning" />
              <span>Initialisation de la caméra…</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onSwitchToManual && (
            <Button
              variant="outline"
              size="sm"
              className="border-slate-600 bg-transparent text-white hover:bg-slate-800"
              onClick={onSwitchToManual}
              data-testid="scan-switch-manual"
            >
              <Keyboard className="mr-2 h-4 w-4" /> Saisie manuelle
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="border-slate-600 bg-transparent text-white hover:bg-slate-800"
            onClick={onClose}
            aria-label="Fermer le scanner"
            data-testid="scan-close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <CameraOff className="h-12 w-12 text-state-error" />
          <p className="text-sm font-medium text-state-error">{error}</p>
          <p className="text-xs text-slate-300">
            Le scanner caméra nécessite HTTPS ou localhost et l'autorisation navigateur.
          </p>
          {onSwitchToManual && (
            <Button onClick={onSwitchToManual} className="mt-4">
              <Keyboard className="mr-2 h-4 w-4" /> Basculer en saisie manuelle
            </Button>
          )}
        </div>
      ) : (
        <div className="relative flex-1">
          {/* La lib injecte la vidéo dans cet élément */}
          <div id={READER_ID} className="absolute inset-0" />
          {/* Cible visuelle au centre */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-64 w-64">
              <div className="absolute left-0 top-0 h-8 w-8 border-l-4 border-t-4 border-ipd" />
              <div className="absolute right-0 top-0 h-8 w-8 border-r-4 border-t-4 border-ipd" />
              <div className="absolute bottom-0 left-0 h-8 w-8 border-b-4 border-l-4 border-ipd" />
              <div className="absolute bottom-0 right-0 h-8 w-8 border-b-4 border-r-4 border-ipd" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
