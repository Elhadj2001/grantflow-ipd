import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Variantes alignées sur les teintes douces de la charte 2025 (mapping
// .ipd-badge de globals.css) : fond tint + texte foncé AA, Poppins.
const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 font-titre text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-ipd-bleu-tint text-ipd-bleu-fonce',
        secondary: 'border-transparent bg-ipd-gris-clair text-ipd-navy',
        outline: 'text-foreground border-ipd-gris',
        success: 'border-transparent bg-ipd-vert-tint text-ipd-vert',
        warning: 'border-transparent bg-ipd-ambre-tint text-ipd-ambre-fonce',
        error: 'border-transparent bg-ipd-rouge-tint text-ipd-rouge',
        muted: 'border-transparent bg-ipd-gris-clair text-ipd-ardoise',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
