import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-center space-y-6 max-w-md px-4">
        <div className="space-y-2">
          <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
          <h2 className="text-2xl font-semibold">Page Not Found</h2>
          <p className="text-muted-foreground">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
        </div>
        <Link
          href="/projects"
          className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
        >
          Go to Projects
        </Link>
      </div>
    </div>
  );
}
