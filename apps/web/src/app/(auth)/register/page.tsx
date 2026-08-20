"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Loader2 } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed");
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-text-primary">
        Create your account
      </h1>
      <p className="mt-1.5 text-sm text-text-secondary">
        One account on this server. It stays on this server.
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
            htmlFor="name"
            className="block text-xs font-medium tracking-wide text-text-muted uppercase"
          >
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            placeholder="Your name"
            autoComplete="name"
            className="input"
          />
        </div>

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
          <label
            htmlFor="password"
            className="block text-xs font-medium tracking-wide text-text-muted uppercase"
          >
            Password
          </label>
          <PasswordInput
            id="password"
            name="password"
            required
            placeholder="At least 8 characters"
            autoComplete="new-password"
            aria-describedby="password-help"
          />
          <p id="password-help" className="text-xs text-text-muted">
            Minimum 8 characters. Stored hashed with bcrypt.
          </p>
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
          {loading ? "Creating account" : "Create account"}
        </button>
      </form>

      <p className="mt-7 border-t border-border-subtle pt-5 text-center text-sm text-text-muted">
        Already have an account?{" "}
        <Link
          href="/login"
          className="text-accent transition-colors hover:text-accent-hover"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
