import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center px-2 py-0.5 text-xs tracking-widest uppercase font-normal transition-colors',
  {
    variants: {
      variant: {
        // Orange badge — the TinyFish "THE TINYFISH ACCELERATOR" tag
        default: 'bg-[#E85A1A] text-white',
        // Black badge
        secondary: 'bg-foreground text-background',
        // Muted
        outline: 'border border-border text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
