"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // The endpoint is deliberately tolerant; we always show the same message.
    } finally {
      setLoading(false);
      setSubmitted(true);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-text-primary">
        Reset your password
      </h1>

      {submitted ? (
        <div className="mt-6 space-y-5">
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-lg bg-success-subtle px-3.5 py-3 text-sm text-success"
          >
            <CheckCircle2
              className="mt-px h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <span>
              If an account exists for that email, a reset link has been sent.
              The link expires in 30 minutes.
            </span>
          </div>
          <p className="text-sm leading-relaxed text-text-secondary">
            Nothing arrived? Check the address you entered, then try again. On a
            self-hosted install, also check that outbound mail is configured.
          </p>
          <Link
            href="/login"
            className="inline-block text-sm text-accent transition-colors hover:text-accent-hover"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
            Enter the email on your account and we&apos;ll send a link to choose
            a new password.
          </p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-5">
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="block text-xs font-medium tracking-wide text-text-muted uppercase"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="input"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !email}
              aria-busy={loading}
              className="btn btn-primary w-full py-2.5"
            >
              {loading && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {loading ? "Sending" : "Send reset link"}
            </button>
          </form>

          <p className="mt-7 border-t border-border-subtle pt-5 text-center text-sm text-text-muted">
            Remembered it?{" "}
            <Link
              href="/login"
              className="text-accent transition-colors hover:text-accent-hover"
            >
              Back to sign in
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
