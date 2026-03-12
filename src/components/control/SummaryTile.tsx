import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SummaryTileProps {
  title: string;
  value: ReactNode;
  description?: ReactNode;
  className?: string;
  titleClassName?: string;
  valueClassName?: string;
  descriptionClassName?: string;
}

export function SummaryTile({
  title,
  value,
  description,
  className,
  titleClassName,
  valueClassName,
  descriptionClassName,
}: SummaryTileProps) {
  return (
    <div
      className={cn(
        'flex h-[116px] flex-col justify-between overflow-hidden rounded-xl border border-border/60 p-4 text-left',
        className
      )}
    >
      <p className={cn('text-sm font-medium text-foreground/88', titleClassName)}>{title}</p>
      <div className="space-y-1.5">
        <div className={cn('line-clamp-2 text-lg font-semibold leading-tight text-foreground', valueClassName)}>{value}</div>
        {description ? (
          <p className={cn('line-clamp-2 text-xs leading-relaxed text-muted-foreground', descriptionClassName)}>{description}</p>
        ) : null}
      </div>
    </div>
  );
}
