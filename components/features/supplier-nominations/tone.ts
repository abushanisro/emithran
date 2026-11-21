/**
 * Presentation-only: maps the colour *names* returned by the nomination helpers
 * (getStatusColor, getRiskLevelColor, getRecommendationColor) to theme-token
 * classes. The old code built class names like `border-${color}-500` at runtime,
 * which Tailwind cannot generate, so those badges rendered unstyled.
 */
export function toneClasses(color: string | undefined): string {
  switch (color) {
    case 'green':
    case 'emerald':
      return 'border-success/30 bg-success/10 text-success';
    case 'red':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'yellow':
    case 'orange':
      return 'border-warning/30 bg-warning/10 text-warning';
    case 'blue':
    case 'cyan':
    case 'teal':
      return 'border-primary/30 bg-primary/10 text-primary';
    default:
      return 'border-border bg-muted text-muted-foreground';
  }
}
