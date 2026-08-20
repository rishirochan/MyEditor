"use client";

import { useState, type FormEvent, use } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { PasswordInput } from "@/components/ui/password-input";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default function ResetPasswordPage({ params }: PageProps) {
  const { token } = use(params);
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    const formData = new FormData(e.currentTarget);
    const nextPassword = String(formData.get("password") || "");
    const nextConfirm = String(formData.get("confirm") || "");

    if (nextPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (nextPassword !== nextConfirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: nextPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not reset password.");
        return;
      }
      setSuccess(true);
      setTimeout(() => router.push("/login"), 1500);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-text-primary">
        Choose a new password
      </h1>

      {success ? (
        <div
          role="status"
          className="mt-6 flex items-start gap-2.5 rounded-lg bg-success-subtle px-3.5 py-3 text-sm text-success"
        >
          <CheckCircle2 className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Password updated. Redirecting to sign in&hellip;</span>
        </div>
      ) : (
        <>
          <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
            This link works once. Set the password you want and sign in with it.
          </p>

          {error && (
            <div
              role="alert"
              className="mt-6 flex items-start gap-2.5 rounded-lg bg-error-subtle px-3.5 py-3 text-sm text-error"
            >
              <AlertCircle
                className="mt-px h-4 w-4 shrink-0"
                aria-hidden="true"
              />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-7 space-y-5">
            <div className="space-y-2">
              <label
                htmlFor="password"
                className="block text-xs font-medium tracking-wide text-text-muted uppercase"
              >
                New password
              </label>
              <PasswordInput
                id="password"
                name="password"
                required
                minLength={8}
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="confirm"
                className="block text-xs font-medium tracking-wide text-text-muted uppercase"
              >
                Confirm new password
              </label>
              <PasswordInput
                id="confirm"
                name="confirm"
                required
                minLength={8}
                placeholder="Re-enter your password"
                autoComplete="new-password"
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
              {loading ? "Updating" : "Update password"}
            </button>
          </form>

          <p className="mt-7 border-t border-border-subtle pt-5 text-center text-sm text-text-muted">
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
