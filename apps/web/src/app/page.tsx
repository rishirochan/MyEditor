import Link from "next/link";
import { ArrowRight, Check, Github } from "lucide-react";
import { getSessionToken, validateSession } from "@/lib/auth/session";

const REPO_URL = "https://github.com/rishirochan/MyEditor";

export default async function HomePage() {
  let isLoggedIn = false;
  try {
    const token = await getSessionToken();
    if (token) {
      const session = await validateSession(token);
      isLoggedIn = !!session;
    }
  } catch {
    // Not logged in
  }
  return (
    <div className="flex min-h-screen flex-col bg-bg-primary">
      {/* Navigation */}
      <nav className="sticky top-0 z-10 border-b border-border-subtle bg-bg-primary">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
          <Link href="/" className="flex items-baseline gap-2.5">
            <span className="font-mono text-lg font-semibold tracking-tight text-text-primary">
              MyEditor
            </span>
            <span className="hidden font-mono text-xs text-text-muted sm:inline">
              self-hosted LaTeX
            </span>
          </Link>
          <div className="flex items-center gap-1.5">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost"
            >
              <Github className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Source</span>
            </a>
            {isLoggedIn ? (
              <Link href="/dashboard" className="btn btn-primary">
                Dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="btn btn-ghost">
                  Sign in
                </Link>
                <Link href="/register" className="btn btn-primary">
                  Create account
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero: claim on the left, the actual thing on the right */}
      <section className="mx-auto w-full max-w-6xl px-6 pt-16 pb-20 lg:pt-24 lg:pb-28">
        <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <p className="font-mono text-xs tracking-wide text-text-muted uppercase">
              Overleaf, on your own box
            </p>
            <h1 className="mt-5 text-4xl leading-[1.08] font-semibold tracking-tight text-text-primary sm:text-5xl">
              Write LaTeX.
              <br />
              Watch the page
              <br />
              <span className="text-accent">set itself.</span>
            </h1>
            <p className="mt-6 max-w-[46ch] text-base leading-relaxed text-text-secondary">
              A browser editor with a live PDF preview, compiled by a sandboxed
              TeX Live container that runs on your hardware. Nothing leaves the
              machine you put it on.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href={isLoggedIn ? "/dashboard" : "/register"}
                className="btn btn-primary px-5 py-2.5 text-base"
              >
                {isLoggedIn ? "Open dashboard" : "Start writing"}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary px-5 py-2.5 text-base"
              >
                Read the source
              </a>
            </div>
            <ul className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs text-text-muted">
              <li>MIT licensed</li>
              <li aria-hidden="true">/</li>
              <li>Docker Compose</li>
              <li aria-hidden="true">/</li>
              <li>TeX Live</li>
              <li aria-hidden="true">/</li>
              <li>REST API</li>
            </ul>
          </div>

          {/* Source in, page out */}
          <div className="lg:col-span-7">
            <div className="panel overflow-hidden shadow-xl">
              <div className="flex items-center justify-between gap-4 border-b border-border-subtle bg-bg-secondary px-4 py-2.5">
                <span className="font-mono text-xs text-text-secondary">
                  gaussian.tex
                </span>
                <span className="inline-flex items-center gap-1.5 font-mono text-xs text-success">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  compiled
                </span>
              </div>

              <div className="grid divide-y divide-border-subtle sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <pre className="overflow-x-auto bg-bg-inset px-4 py-5 font-mono text-[13px] leading-[1.7] text-text-secondary">
                  <code>
                    <span className="text-text-muted">
                      % one section, one identity
                    </span>
                    {"\n"}
                    <span className="text-text-primary">{"\\section"}</span>
                    {"{Gaussian integral}\n\n"}
                    {"The classic result:\n"}
                    <span className="text-text-primary">{"\\begin"}</span>
                    {"{equation}\n"}
                    {"  "}
                    <span className="text-text-primary">{"\\int"}</span>
                    {"_0^{"}
                    <span className="text-text-primary">{"\\infty"}</span>
                    {"} e^{-x^2}\\,dx\n"}
                    {"    = "}
                    <span className="text-text-primary">{"\\frac"}</span>
                    {"{"}
                    <span className="text-text-primary">{"\\sqrt"}</span>
                    {"{"}
                    <span className="text-text-primary">{"\\pi"}</span>
                    {"}}{2}\n"}
                    <span className="text-text-primary">{"\\end"}</span>
                    {"{equation}"}
                  </code>
                </pre>

                <div className="bg-bg-primary px-6 py-5 font-serif">
                  <p className="text-base font-semibold text-text-primary">
                    <span className="mr-2 tabular-nums">1</span>
                    Gaussian integral
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-text-secondary">
                    The classic result:
                  </p>
                  <div className="mt-5 flex items-center justify-center gap-1.5 text-text-primary">
                    <span className="inline-flex items-stretch gap-0.5">
                      <span className="text-3xl leading-none">&#8747;</span>
                      <span className="flex flex-col justify-between py-0.5 text-[10px] leading-none">
                        <span>&#8734;</span>
                        <span>0</span>
                      </span>
                    </span>
                    <span className="italic">
                      e
                      <sup className="text-[10px] not-italic">
                        &#8722;x&#178;
                      </sup>
                    </span>
                    <span className="italic">dx</span>
                    <span className="mx-1.5">=</span>
                    <span className="inline-flex flex-col items-center leading-none">
                      <span className="px-1.5 pb-1">&#8730;&#960;</span>
                      <span className="border-t border-current px-1.5 pt-1">
                        2
                      </span>
                    </span>
                  </div>
                  <p className="mt-6 text-right font-sans text-[11px] text-text-muted">
                    preview refreshes as you type
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The one claim that carries weight, then the two footnotes to it */}
      <section className="border-t border-border-subtle">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-12 lg:gap-16 lg:py-24">
          <div className="lg:col-span-7">
            <p className="font-mono text-xs tracking-wide text-text-muted uppercase">
              No limits
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
              No file caps, no compile timeouts, no project quota.
            </h2>
            <p className="mt-6 max-w-[64ch] text-base leading-relaxed text-text-secondary">
              The only ceiling is the machine you run it on. A 400 page thesis
              with two hundred figures is a scheduling question, not a billing
              one, and a compile that takes ninety seconds is allowed to take
              ninety seconds.
            </p>
          </div>

          <div className="flex flex-col divide-y divide-border-subtle lg:col-span-5 lg:border-l lg:border-border-subtle lg:pl-12">
            <div className="pb-8">
              <p className="font-mono text-xs tracking-wide text-text-muted uppercase">
                Self-hostable
              </p>
              <p className="mt-3 text-lg leading-snug font-medium text-text-primary">
                Your server, your data, your TeX Live image.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                Postgres, Redis, the compile worker, and the web app ship as one
                Compose file. No third party sees a draft.
              </p>
            </div>
            <div className="pt-8">
              <p className="font-mono text-xs tracking-wide text-text-muted uppercase">
                Open source
              </p>
              <p className="mt-3 text-sm leading-relaxed text-text-secondary">
                MIT licensed, top to bottom. Read it, fork it, run it forever.{" "}
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent underline decoration-accent-muted underline-offset-4 transition-colors hover:text-accent-hover"
                >
                  github.com/rishirochan/MyEditor
                </a>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Closing: show the install, not a promise about it */}
      <section className="border-t border-border-subtle bg-bg-secondary">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-16 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
              Running it takes one command.
            </h2>
            <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-text-secondary">
              Clone the repo, set your environment file, bring the stack up. The
              editor is on port 3000 a minute later.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-4 md:items-end">
            <div className="rounded-lg border border-border bg-bg-inset px-4 py-3 font-mono text-sm text-text-primary">
              <span className="pr-2 text-text-muted select-none">$</span>
              docker compose up -d
            </div>
            <Link
              href={isLoggedIn ? "/dashboard" : "/register"}
              className="btn btn-primary px-5 py-2.5 text-base"
            >
              {isLoggedIn ? "Open dashboard" : "Create an account"}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-border-subtle">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 font-mono text-xs text-text-muted">
          <span>MyEditor</span>
          <span>MIT licensed / self-hosted LaTeX editor</span>
        </div>
      </footer>
    </div>
  );
}
