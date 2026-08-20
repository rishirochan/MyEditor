import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-7 bg-bg-tertiary px-4 py-12">
      <header className="text-center">
        <Link href="/" className="inline-flex items-baseline gap-2">
          <span className="font-mono text-xl font-semibold tracking-tight text-text-primary">
            MyEditor
          </span>
        </Link>
        <p className="mt-1.5 font-mono text-xs tracking-wide text-text-muted">
          self-hosted LaTeX
        </p>
      </header>

      <main className="w-full max-w-md">
        <div className="panel animate-slide-up p-8 shadow-xl">{children}</div>
      </main>

      <footer className="text-center font-mono text-xs text-text-muted">
        MIT licensed / runs on your hardware
      </footer>
    </div>
  );
}
