'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';

/**
 * Toaster monté une fois dans le RootLayout — consomme le store
 * useToast() et rend chaque toast dans le Viewport (coin bas-droit).
 *
 * Sprint F1.1 : harmonisation des icônes :
 *   - variant 'success'   → CheckCircle2 (vert)
 *   - variant 'destructive' → XCircle (rouge)
 *   - variant 'default'   → pas d'icône
 */
export function Toaster() {
  const { toasts } = useToast();
  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, action, variant, ...props }) => {
        const Icon =
          variant === 'success'
            ? CheckCircle2
            : variant === 'destructive'
              ? XCircle
              : null;
        return (
          <Toast key={id} variant={variant} {...props}>
            <div className="flex items-start gap-3">
              {Icon && (
                <Icon
                  className="mt-0.5 h-5 w-5 shrink-0"
                  aria-hidden
                />
              )}
              <div className="grid gap-1">
                {title && <ToastTitle>{title}</ToastTitle>}
                {description && <ToastDescription>{description}</ToastDescription>}
              </div>
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
