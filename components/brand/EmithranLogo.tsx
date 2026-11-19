import { cn } from '@/lib/utils'

const MASK = 'url(/brand/emithran-mark.png)'

/**
 * The EMITHRAN ring-M mark (ubaabu's logo), painted with the current text colour through a mask, so one file serves every
 * theme: ink on light, white on dark.
 */
export function EmithranMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block aspect-square shrink-0 bg-current', className)}
      style={{
        maskImage: MASK, WebkitMaskImage: MASK,
        maskSize: 'contain', WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center', WebkitMaskPosition: 'center',
      }}
    />
  )
}

/** The mark beside the EMITHRAN wordmark in Sora, as the marketing site's navbar draws it. */
export function EmithranLogo({ className, markClassName, wordmarkClassName }: { className?: string; markClassName?: string; wordmarkClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <EmithranMark className={cn('h-7', markClassName)} />
      <span className={cn('font-display text-lg font-semibold tracking-tight leading-none', wordmarkClassName)}>EMITHRAN</span>
    </span>
  )
}
