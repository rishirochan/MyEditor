"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { AlertCircle, Loader2 } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";

function safeRedirectPath(value: string | null): string {
  if (!value) return "/dashboard";
  if (!value.startsWith("/")) return "/dashboard";

  const baseUrl = new URL("http://localhost");
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(value, baseUrl);
  } catch {
    return "/dashboard";
  }

  if (redirectUrl.origin !== baseUrl.origin) return "/dashboard";
  if (
    redirectUrl.pathname.startsWith("/login") ||
    redirectUrl.pathname.startsWith("/register")
  ) {
    return "/dashboard";
  }
  const path = `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`;
  // "/..//evil.com" normalizes to a protocol-relative URL — same origin here,
  // off-site once assigned to window.location.
  return path.startsWith("//") ? "/dashboard" : path;
}

export default function LoginPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    // Read from the DOM so browser autofill (Arc/Chrome) is included.
    // Controlled React state alone often misses autofilled values.
    const formData = new FormData(e.currentTarget);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed");
        return;
      }

      const redirectParam = new URLSearchParams(window.location.search).get(
        "redirect"
      );
      window.location.href = safeRedirectPath(redirectParam);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-text-primary">
        Sign in
      </h1>
      <p className="mt-1.5 text-sm text-text-secondary">
        Pick up where you left off in your documents.
      </p>

      {error && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-2.5 rounded-lg bg-error-subtle px-3.5 py-3 text-sm text-error"
        >
          <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

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
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            autoComplete="email"
            className="input"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <label
              htmlFor="password"
              className="block text-xs font-medium tracking-wide text-text-muted uppercase"
            >
              Password
            </label>
            <Link
              href="/forgot"
              className="text-xs text-text-muted transition-colors hover:text-text-primary"
            >
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            name="password"
            required
            placeholder="Enter your password"
            autoComplete="current-password"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          aria-busy={loading}
          className="btn btn-primary w-full py-2.5"
        >
          {loading && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          {loading ? "Signing in" : "Sign in"}
        </button>
      </form>

      <p className="mt-7 border-t border-border-subtle pt-5 text-center text-sm text-text-muted">
        Don&apos;t have an account?{" "}
        <Link
          href="/register"
          className="text-accent transition-colors hover:text-accent-hover"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
