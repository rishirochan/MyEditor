"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Loader2, Check, AlertCircle, Sparkles, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PasswordPromptDialog } from "@/components/ui/password-prompt-dialog";
import { PasswordInput } from "@/components/ui/password-input";
import {
  defaultModelForProvider,
  modelsForProvider,
} from "@/lib/ai/models";
import type { AiProvider } from "@/lib/ai/types";
import { isCliProvider } from "@/lib/ai/types";

interface UserInfo {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

interface AiModelFormState {
  provider: AiProvider;
  model: string;
  endpoint: string;
  apiKey: string;
  apiKeySet: boolean;
}

interface AiSettingsResponse {
  settings: {
    enabled: boolean;
    buildFix: {
      provider: AiProvider;
      model: string;
      endpoint: string | null;
      apiKeySet: boolean;
    };
    latexWriter: {
      provider: AiProvider;
      model: string;
      endpoint: string | null;
      apiKeySet: boolean;
    };
  };
}

interface CliModelOption {
  id: string;
  label: string;
}

interface CliProviderStatus {
  installed: boolean;
  authenticated: boolean;
  binaryPath: string | null;
  email: string | null;
  subscriptionType: string | null;
  detail: string | null;
}

interface CliStatusResponse {
  status: {
    claude: CliProviderStatus;
    codex: CliProviderStatus;
    models: {
      claude: CliModelOption[];
      codex: CliModelOption[];
    };
  };
}

function defaultAiModelState(): AiModelFormState {
  return {
    provider: "openai",
    model: "gpt-4o-mini",
    endpoint: "",
    apiKey: "",
    apiKeySet: false,
  };
}

function providerLabel(provider: AiProvider): string {
  switch (provider) {
    case "openrouter":
      return "OpenRouter";
    case "anthropic":
      return "Anthropic";
    case "custom":
      return "Custom endpoint";
    case "claude-cli":
      return "Claude CLI";
    case "codex-cli":
      return "Codex CLI";
    case "openai":
    default:
      return "OpenAI";
  }
}

function AiModelField({
  provider,
  model,
  onModelChange,
  cliModels,
}: {
  provider: AiProvider;
  model: string;
  onModelChange: (model: string) => void;
  cliModels: CliStatusResponse["status"]["models"] | null;
}) {
  if (provider === "custom") {
    return (
      <input
        type="text"
        value={model}
        onChange={(e) => onModelChange(e.target.value)}
        required
        className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
        placeholder={defaultModelForProvider(provider)}
      />
    );
  }

  const liveOptions =
    provider === "claude-cli"
      ? cliModels?.claude
      : provider === "codex-cli"
        ? cliModels?.codex
        : null;

  const options =
    liveOptions && liveOptions.length > 0
      ? (() => {
          const ids = liveOptions.map((option) => option.id);
          if (model.trim() && !ids.includes(model.trim())) {
            return [{ id: model.trim(), label: model.trim() }, ...liveOptions];
          }
          return liveOptions;
        })()
      : modelsForProvider(provider, model).map((id) => ({ id, label: id }));

  return (
    <Select value={model} onValueChange={onModelChange}>
      <SelectTrigger className="w-full bg-bg-primary">
        <SelectValue placeholder="Select model" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);

  const [user, setUser] = useState<UserInfo | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState("");
  const [profileError, setProfileError] = useState("");
  const [pwPromptOpen, setPwPromptOpen] = useState(false);
  const [pwPromptError, setPwPromptError] = useState<string | null>(null);

  const [buildFixModel, setBuildFixModel] = useState<AiModelFormState>(
    defaultAiModelState()
  );
  const [latexWriterModel, setLatexWriterModel] = useState<AiModelFormState>(
    defaultAiModelState()
  );
  const [aiSaving, setAiSaving] = useState(false);
  const [aiSuccess, setAiSuccess] = useState("");
  const [aiError, setAiError] = useState("");
  const [cliStatus, setCliStatus] = useState<CliStatusResponse["status"] | null>(
    null
  );
  const [cliStatusLoading, setCliStatusLoading] = useState(false);
  const [cliLoginBusy, setCliLoginBusy] = useState<"claude-cli" | "codex-cli" | null>(
    null
  );
  const [cliMessage, setCliMessage] = useState("");

  const refreshCliStatus = useCallback(async () => {
    setCliStatusLoading(true);
    try {
      const res = await fetch("/api/ai/cli-status", { cache: "no-store" });
      if (!res.ok) {
        setCliMessage("Failed to detect local CLI status");
        return;
      }
      const data = (await res.json()) as CliStatusResponse;
      setCliStatus(data.status);
      setCliMessage("");
    } catch {
      setCliMessage("Failed to detect local CLI status");
    } finally {
      setCliStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    async function loadSettings() {
      try {
        const [userRes, aiRes] = await Promise.all([
          fetch("/api/auth/me", { cache: "no-store" }),
          fetch("/api/ai/settings", { cache: "no-store" }),
        ]);

        if (userRes.ok) {
          const userData = await userRes.json();
          setUser(userData.user);
          setName(userData.user.name);
          setEmail(userData.user.email);
        }

        if (aiRes.ok) {
          const aiData = (await aiRes.json()) as AiSettingsResponse;
          setBuildFixModel({
            provider: aiData.settings.buildFix.provider,
            model: aiData.settings.buildFix.model,
            endpoint: aiData.settings.buildFix.endpoint ?? "",
            apiKey: "",
            apiKeySet: aiData.settings.buildFix.apiKeySet,
          });
          setLatexWriterModel({
            provider: aiData.settings.latexWriter.provider,
            model: aiData.settings.latexWriter.model,
            endpoint: aiData.settings.latexWriter.endpoint ?? "",
            apiKey: "",
            apiKeySet: aiData.settings.latexWriter.apiKeySet,
          });
        }

        await refreshCliStatus();
      } catch {
        setProfileError("Failed to load settings");
      } finally {
        setLoading(false);
      }
    }

    loadSettings();
  }, [refreshCliStatus]);

  async function startCliLogin(provider: "claude-cli" | "codex-cli") {
    setCliLoginBusy(provider);
    setCliMessage("");
    try {
      const res = await fetch("/api/ai/cli-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCliMessage(payload.error || "Failed to start CLI login");
        return;
      }
      setCliMessage(
        payload.message ||
          "Login opened in your browser. Click Refresh after finishing."
      );
      setTimeout(() => {
        void refreshCliStatus();
      }, 2500);
    } catch {
      setCliMessage("Failed to start CLI login");
    } finally {
      setCliLoginBusy(null);
    }
  }

  function onProviderChange(
    purpose: "buildFix" | "latexWriter",
    provider: AiProvider
  ) {
    const liveDefault =
      provider === "claude-cli"
        ? cliStatus?.models.claude[0]?.id
        : provider === "codex-cli"
          ? cliStatus?.models.codex[0]?.id
          : null;

    const updater = (prev: AiModelFormState): AiModelFormState => ({
      ...prev,
      provider,
      model: liveDefault || defaultModelForProvider(provider),
      endpoint: isCliProvider(provider) ? "" : prev.endpoint,
      apiKey: isCliProvider(provider) ? "" : prev.apiKey,
    });
    if (purpose === "buildFix") setBuildFixModel(updater);
    else setLatexWriterModel(updater);
  }

  function onProfileSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProfileError("");
    setProfileSuccess("");

    const emailChanged =
      !!user && email.trim().toLowerCase() !== user.email.toLowerCase();

    if (emailChanged) {
      setPwPromptError(null);
      setPwPromptOpen(true);
      return;
    }

    void submitProfile(null);
  }

  async function submitProfile(currentPassword: string | null) {
    setProfileSaving(true);
    try {
      const body: Record<string, unknown> = { name, email };
      if (currentPassword !== null) body.currentPassword = currentPassword;

      const res = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = payload.error || "Failed to update profile";
        // If the server rejected the password, keep the dialog open and show
        // the error inline; otherwise close and show in the page.
        if (res.status === 401 && currentPassword !== null) {
          setPwPromptError(msg);
        } else {
          setPwPromptOpen(false);
          setPwPromptError(null);
          setProfileError(msg);
        }
        return;
      }

      setUser(payload.user);
      setName(payload.user.name);
      setEmail(payload.user.email);
      setPwPromptOpen(false);
      setPwPromptError(null);
      setProfileSuccess("Profile updated successfully");
      setTimeout(() => setProfileSuccess(""), 3000);
    } catch {
      setPwPromptOpen(false);
      setPwPromptError(null);
      setProfileError("Failed to update profile");
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveAiSettings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAiError("");
    setAiSuccess("");
    setAiSaving(true);

    try {
      const buildFixPayload: Record<string, unknown> = {
        provider: buildFixModel.provider,
        model: buildFixModel.model.trim(),
        endpoint: buildFixModel.endpoint.trim() || null,
      };
      const latexWriterPayload: Record<string, unknown> = {
        provider: latexWriterModel.provider,
        model: latexWriterModel.model.trim(),
        endpoint: latexWriterModel.endpoint.trim() || null,
      };

      if (buildFixModel.apiKey.trim().length > 0) {
        buildFixPayload.apiKey = buildFixModel.apiKey.trim();
      }
      if (latexWriterModel.apiKey.trim().length > 0) {
        latexWriterPayload.apiKey = latexWriterModel.apiKey.trim();
      }

      const res = await fetch("/api/ai/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          buildFix: buildFixPayload,
          latexWriter: latexWriterPayload,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAiError(payload.error || "Failed to save AI settings");
        return;
      }

      const saved = payload.settings as AiSettingsResponse["settings"];
      setBuildFixModel((prev) => ({
        ...prev,
        provider: saved.buildFix.provider,
        model: saved.buildFix.model,
        endpoint: saved.buildFix.endpoint ?? "",
        apiKey: "",
        apiKeySet: saved.buildFix.apiKeySet,
      }));
      setLatexWriterModel((prev) => ({
        ...prev,
        provider: saved.latexWriter.provider,
        model: saved.latexWriter.model,
        endpoint: saved.latexWriter.endpoint ?? "",
        apiKey: "",
        apiKeySet: saved.latexWriter.apiKeySet,
      }));

      setAiSuccess("AI settings saved successfully");
      setTimeout(() => setAiSuccess(""), 3000);
    } catch {
      setAiError("Failed to save AI settings");
    } finally {
      setAiSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="text-text-secondary">Unable to load settings.</p>
        <Link
          href="/dashboard"
          className="mt-4 text-sm text-accent hover:text-accent-hover transition-colors"
        >
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <PasswordPromptDialog
        open={pwPromptOpen}
        title="Confirm email change"
        message="Enter your current password to change the email on your account."
        confirmLabel="Change email"
        submitting={profileSaving}
        errorMessage={pwPromptError}
        onConfirm={(pw) => {
          setPwPromptError(null);
          void submitProfile(pw);
        }}
        onCancel={() => {
          setPwPromptOpen(false);
          setPwPromptError(null);
          setProfileSaving(false);
        }}
      />

      <div>
        <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Manage profile and AI model preferences
        </p>
      </div>

      <section className="max-w-2xl space-y-5">
        <div className="border-b border-border pb-2">
          <h2 className="text-lg font-semibold text-text-primary">Profile</h2>
          <p className="text-xs text-text-muted">
            Update your account details
          </p>
        </div>

        {profileError && (
          <div className="flex items-center gap-2 rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {profileError}
          </div>
        )}

        {profileSuccess && (
          <div className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3 text-sm text-success">
            <Check className="h-4 w-4 shrink-0" />
            {profileSuccess}
          </div>
        )}

        <form onSubmit={onProfileSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="name"
              className="mb-1.5 block text-sm font-medium text-text-secondary"
            >
              Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={255}
              className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block text-sm font-medium text-text-secondary"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
            />
            {user && email.trim().toLowerCase() !== user.email.toLowerCase() && (
              <p className="mt-1 text-xs text-text-muted">
                Changing your email will require your current password.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={profileSaving}
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {profileSaving ? "Saving..." : "Save Profile"}
          </button>
        </form>
      </section>

      <section className="max-w-4xl space-y-5">
        <div className="border-b border-border pb-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Sparkles className="h-4 w-4 text-accent" />
            AI Settings
          </h2>
          <p className="text-xs text-text-muted">
            Choose separate providers/models for build fixes and LaTeX writing
          </p>
        </div>

        {aiError && (
          <div className="flex items-center gap-2 rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {aiError}
          </div>
        )}

        {aiSuccess && (
          <div className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3 text-sm text-success">
            <Check className="h-4 w-4 shrink-0" />
            {aiSuccess}
          </div>
        )}

        <form onSubmit={saveAiSettings} className="space-y-6">
          <div className="rounded-lg border border-border bg-bg-secondary p-4 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  Local CLI status
                </h3>
                <p className="mt-1 text-xs text-text-muted">
                  Use your Claude or ChatGPT subscription via the CLIs already
                  installed on this machine. No proxy required.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshCliStatus()}
                disabled={cliStatusLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-tertiary disabled:opacity-50"
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5", cliStatusLoading && "animate-spin")}
                />
                Refresh
              </button>
            </div>

            {cliMessage && (
              <p className="text-xs text-text-muted">{cliMessage}</p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  {
                    key: "claude" as const,
                    label: "Claude CLI",
                    provider: "claude-cli" as const,
                  },
                  {
                    key: "codex" as const,
                    label: "Codex CLI",
                    provider: "codex-cli" as const,
                  },
                ] as const
              ).map(({ key, label, provider }) => {
                const status = cliStatus?.[key];
                const ready = Boolean(status?.installed && status.authenticated);
                return (
                  <div
                    key={key}
                    className="rounded-md border border-border bg-bg-primary p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-text-primary">
                        {label}
                      </p>
                      <span
                        className={cn(
                          "text-[11px] font-medium",
                          ready ? "text-success" : "text-text-muted"
                        )}
                      >
                        {!status
                          ? "Checking…"
                          : !status.installed
                            ? "Not installed"
                            : status.authenticated
                              ? "Logged in"
                              : "Not logged in"}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted break-all">
                      {status?.email
                        ? status.email
                        : status?.binaryPath
                          ? status.binaryPath
                          : status?.detail || "—"}
                    </p>
                    {status?.subscriptionType && status.authenticated && (
                      <p className="text-[11px] text-text-muted">
                        Plan: {status.subscriptionType}
                      </p>
                    )}
                    {!ready && (
                      <button
                        type="button"
                        onClick={() => void startCliLogin(provider)}
                        disabled={
                          !status?.installed || cliLoginBusy === provider
                        }
                        className="rounded-md bg-accent/15 px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {cliLoginBusy === provider ? "Opening…" : "Log in"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-bg-secondary p-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  Build Fix AI
                </h3>
                <p className="text-xs text-text-muted">
                  Used by “Fix with AI” in build logs
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Provider
                </label>
                <Select
                  value={buildFixModel.provider}
                  onValueChange={(value) =>
                    onProviderChange("buildFix", value as AiProvider)
                  }
                >
                  <SelectTrigger className="w-full bg-bg-primary">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="custom">Custom endpoint</SelectItem>
                    <SelectItem value="claude-cli">
                      Claude CLI (subscription)
                    </SelectItem>
                    <SelectItem value="codex-cli">
                      Codex CLI (subscription)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Model
                </label>
                <AiModelField
                  provider={buildFixModel.provider}
                  model={buildFixModel.model}
                  cliModels={cliStatus?.models ?? null}
                  onModelChange={(value) =>
                    setBuildFixModel((prev) => ({ ...prev, model: value }))
                  }
                />
              </div>

              {!isCliProvider(buildFixModel.provider) && (
                <>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                      Endpoint URL
                    </label>
                    <input
                      type="url"
                      value={buildFixModel.endpoint}
                      onChange={(e) =>
                        setBuildFixModel((prev) => ({
                          ...prev,
                          endpoint: e.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
                      placeholder={
                        buildFixModel.provider === "custom"
                          ? "https://your-host/v1"
                          : "Optional override"
                      }
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                      API Key
                    </label>
                    <PasswordInput
                      value={buildFixModel.apiKey}
                      onChange={(e) =>
                        setBuildFixModel((prev) => ({
                          ...prev,
                          apiKey: e.target.value,
                        }))
                      }
                      className="bg-bg-primary"
                      placeholder={
                        buildFixModel.apiKeySet
                          ? "Stored key exists, leave blank to keep"
                          : "sk-..."
                      }
                    />
                    <p className="mt-1 text-xs text-text-muted">
                      Required for API providers. Saved encrypted to your account.
                      Leave blank to use the server&apos;s fallback key if configured.
                    </p>
                  </div>
                </>
              )}

              {isCliProvider(buildFixModel.provider) && (
                <p className="text-xs text-text-muted">
                  Uses your local {providerLabel(buildFixModel.provider)} login.
                  No API key or endpoint needed.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-border bg-bg-secondary p-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  LaTeX Writer AI
                </h3>
                <p className="text-xs text-text-muted">
                  Reserved for AI writing/generation actions
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Provider
                </label>
                <Select
                  value={latexWriterModel.provider}
                  onValueChange={(value) =>
                    onProviderChange("latexWriter", value as AiProvider)
                  }
                >
                  <SelectTrigger className="w-full bg-bg-primary">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="custom">Custom endpoint</SelectItem>
                    <SelectItem value="claude-cli">
                      Claude CLI (subscription)
                    </SelectItem>
                    <SelectItem value="codex-cli">
                      Codex CLI (subscription)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Model
                </label>
                <AiModelField
                  provider={latexWriterModel.provider}
                  model={latexWriterModel.model}
                  cliModels={cliStatus?.models ?? null}
                  onModelChange={(value) =>
                    setLatexWriterModel((prev) => ({ ...prev, model: value }))
                  }
                />
              </div>

              {!isCliProvider(latexWriterModel.provider) && (
                <>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                      Endpoint URL
                    </label>
                    <input
                      type="url"
                      value={latexWriterModel.endpoint}
                      onChange={(e) =>
                        setLatexWriterModel((prev) => ({
                          ...prev,
                          endpoint: e.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
                      placeholder={
                        latexWriterModel.provider === "custom"
                          ? "https://your-host/v1"
                          : "Optional override"
                      }
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                      API Key
                    </label>
                    <PasswordInput
                      value={latexWriterModel.apiKey}
                      onChange={(e) =>
                        setLatexWriterModel((prev) => ({
                          ...prev,
                          apiKey: e.target.value,
                        }))
                      }
                      className="bg-bg-primary"
                      placeholder={
                        latexWriterModel.apiKeySet
                          ? "Stored key exists, leave blank to keep"
                          : "sk-..."
                      }
                    />
                    <p className="mt-1 text-xs text-text-muted">
                      Required for API providers. Saved encrypted to your account.
                      Leave blank to use the server&apos;s fallback key if configured.
                    </p>
                  </div>
                </>
              )}

              {isCliProvider(latexWriterModel.provider) && (
                <p className="text-xs text-text-muted">
                  Uses your local {providerLabel(latexWriterModel.provider)} login.
                  No API key or endpoint needed.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-bg-secondary px-4 py-3 text-xs text-text-muted">
            Active providers: Build Fix → {providerLabel(buildFixModel.provider)}, LaTeX
            Writer → {providerLabel(latexWriterModel.provider)}
          </div>

          <button
            type="submit"
            disabled={aiSaving}
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {aiSaving ? "Saving..." : "Save AI Settings"}
          </button>
        </form>
      </section>
    </div>
  );
}
