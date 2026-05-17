import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-ipd-dark text-white',
        secondary: 'border-transparent bg-navy text-white',
        outline: 'text-foreground border-slate-200',
        success: 'border-transparent bg-state-success/15 text-state-success',
        warning: 'border-transparent bg-state-warning/15 text-state-warning',
        error: 'border-transparent bg-state-error/15 text-state-error',
        muted: 'border-transparent bg-slate-100 text-slate-muted',
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
