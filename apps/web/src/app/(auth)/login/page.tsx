"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
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
      <h1 className="mb-6 text-2xl font-bold text-text-primary">
        Sign in to your account
      </h1>

      {error && (
        <div className="mb-4 rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block text-sm font-medium text-text-secondary"
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
            className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-1.5 block text-sm font-medium text-text-secondary"
          >
            Password
          </label>
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
          className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm">
        <Link
          href="/forgot"
          className="text-text-muted transition-colors hover:text-text-primary"
        >
          Forgot password?
        </Link>
      </p>

      <p className="mt-6 text-center text-sm text-text-muted">
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
