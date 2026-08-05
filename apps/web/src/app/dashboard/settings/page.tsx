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
import {
  CLAUDE_LATEST_FAMILY,
  CODEX_LATEST_FALLBACK,
} from "@/lib/ai/cliModelCatalog";

interface UserInfo {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

interface AiModelFormState {
  provider: AiProvider;
  model: string;
  effort: string | null;
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
      effort: string | null;
      endpoint: string | null;
      apiKeySet: boolean;
    };
    latexWriter: {
      provider: AiProvider;
      model: string;
      effort: string | null;
      endpoint: string | null;
      apiKeySet: boolean;
    };
  };
}

interface CliReasoningLevel {
  effort: string;
  description?: string;
}

interface CliModelOption {
  id: string;
  label: string;
  defaultEffort?: string;
  efforts?: CliReasoningLevel[];
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
  return normalizeCliOnlyModelState({
    provider: "claude-cli",
    model: defaultModelForProvider("claude-cli"),
    effort: null,
    endpoint: null,
    apiKeySet: false,
  });
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

function effortLabel(effort: string): string {
  switch (effort) {
    case "low":
      return "Low";
    case "medium":
      return "Med";
    case "high":
      return "High";
    case "xhigh":
      return "XHigh";
    case "max":
      return "Max";
    case "ultra":
      return "Ultra";
    default:
      return effort;
  }
}

function resolveEffortForModel(
  models: CliModelOption[] | null | undefined,
  modelId: string,
  preferred?: string | null
): string | null {
  const match = models?.find((option) => option.id === modelId);
  const efforts = match?.efforts ?? [];
  if (efforts.length === 0) return null;
  if (preferred && efforts.some((level) => level.effort === preferred)) {
    return preferred;
  }
  return match?.defaultEffort ?? efforts[0]?.effort ?? null;
}

/** Live CLI list when we have one, else the compiled-in fallback. */
function cliOptionsFor(
  provider: AiProvider,
  cliModels?: CliStatusResponse["status"]["models"] | null
): CliModelOption[] {
  const live =
    provider === "claude-cli" ? cliModels?.claude : cliModels?.codex;
  if (live && live.length > 0) return live;
  return provider === "claude-cli" ? CLAUDE_LATEST_FAMILY : CODEX_LATEST_FALLBACK;
}

function normalizeCliOnlyModelState(
  settings: AiSettingsResponse["settings"]["buildFix"],
  cliModels?: CliStatusResponse["status"]["models"] | null
): AiModelFormState {
  const provider = isCliProvider(settings.provider)
    ? settings.provider
    : "claude-cli";
  // Validate against the live list too, or a model the CLI just shipped gets
  // silently rewritten back to the hardcoded default after save.
  const models = cliOptionsFor(provider, cliModels);
  const requestedModel = isCliProvider(settings.provider)
    ? settings.model.trim()
    : defaultModelForProvider(provider);
  const model = models.some((option) => option.id === requestedModel)
    ? requestedModel
    : defaultModelForProvider(provider);

  return {
    provider,
    model,
    effort: resolveEffortForModel(models, model, settings.effort),
    endpoint: "",
    apiKey: "",
    apiKeySet: false,
  };
}

function AiModelField({
  provider,
  model,
  effort,
  onModelChange,
  onEffortChange,
  cliModels,
}: {
  provider: AiProvider;
  model: string;
  effort: string | null;
  onModelChange: (model: string, effort: string | null) => void;
  onEffortChange: (effort: string) => void;
  cliModels: CliStatusResponse["status"]["models"] | null;
}) {
  if (provider === "custom") {
    return (
      <input
        type="text"
        value={model}
        onChange={(e) => onModelChange(e.target.value, null)}
        required
        className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
        placeholder={defaultModelForProvider(provider)}
      />
    );
  }

  const options: CliModelOption[] = isCliProvider(provider)
    ? cliOptionsFor(provider, cliModels)
    : modelsForProvider(provider, undefined).map((id) => ({ id, label: id }));

  // Keep API-key providers tolerant of custom saved model IDs; CLI providers
  // stay on the latest family only.
  const selectOptions: CliModelOption[] =
    !isCliProvider(provider) &&
    model.trim() &&
    !options.some((option) => option.id === model.trim())
      ? [{ id: model.trim(), label: model.trim() }, ...options]
      : options;

  const effectiveModel =
    isCliProvider(provider) &&
    model.trim() &&
    !selectOptions.some((option) => option.id === model.trim())
      ? selectOptions[0]?.id || model
      : model;

  const selected = selectOptions.find((option) => option.id === effectiveModel);
  const efforts = selected?.efforts ?? [];
  const activeEffort =
    (effort && efforts.some((level) => level.effort === effort)
      ? effort
      : selected?.defaultEffort) ??
    efforts[0]?.effort ??
    null;

  return (
    <div className="space-y-3">
      <Select
        value={effectiveModel}
        onValueChange={(value) => {
          const nextEffort = resolveEffortForModel(selectOptions, value, effort);
          onModelChange(value, nextEffort);
        }}
      >
        <SelectTrigger className="w-full bg-bg-primary">
          <SelectValue placeholder="Select model" />
        </SelectTrigger>
        <SelectContent>
          {selectOptions.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isCliProvider(provider) && efforts.length > 0 && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-muted">
            Intelligence
          </label>
          <div
            role="radiogroup"
            aria-label="Intelligence level"
            className="flex flex-wrap gap-1 rounded-lg border border-border bg-bg-primary p-1"
          >
            {efforts.map((level) => {
              const selectedEffort = level.effort === activeEffort;
              return (
                <button
                  key={level.effort}
                  type="button"
                  role="radio"
                  aria-checked={selectedEffort}
                  title={level.description || effortLabel(level.effort)}
                  onClick={() => onEffortChange(level.effort)}
                  className={cn(
                    "min-w-[3.25rem] flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                    selectedEffort
                      ? "bg-accent text-white"
                      : "text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
                  )}
                >
                  {effortLabel(level.effort)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
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
      const res = await fetch("/api/ai/cli-status", {
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
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
    if (!cliStatus?.models) return;

    function snapCliSelection(prev: AiModelFormState): AiModelFormState {
      if (!isCliProvider(prev.provider)) return prev;
      const models =
        prev.provider === "claude-cli"
          ? cliStatus!.models.claude
          : cliStatus!.models.codex;
      if (!models.length) return prev;
      const nextModel = models.some((option) => option.id === prev.model)
        ? prev.model
        : models[0]!.id;
      const nextEffort = resolveEffortForModel(models, nextModel, prev.effort);
      if (nextModel === prev.model && nextEffort === prev.effort) return prev;
      return { ...prev, model: nextModel, effort: nextEffort };
    }

    setBuildFixModel(snapCliSelection);
    setLatexWriterModel(snapCliSelection);
  }, [cliStatus]);

  useEffect(() => {
    async function loadSettings() {
      try {
        const [userRes, aiRes] = await Promise.all([
          fetch("/api/auth/me", { cache: "no-store" }),
          fetch("/api/ai/settings", { cache: "no-store" }),
        ]);

        if (userRes.status === 401) {
          const redirect = encodeURIComponent("/dashboard/settings");
          window.location.href = `/login?redirect=${redirect}`;
          return;
        }

        if (userRes.ok) {
          const userData = await userRes.json();
          setUser(userData.user);
          setName(userData.user.name);
          setEmail(userData.user.email);
        }

        if (aiRes.ok) {
          const aiData = (await aiRes.json()) as AiSettingsResponse;
          // cliStatus is still null here; the snapCliSelection effect re-runs
          // once the live list arrives.
          setBuildFixModel(
            normalizeCliOnlyModelState(aiData.settings.buildFix)
          );
          setLatexWriterModel(
            normalizeCliOnlyModelState(aiData.settings.latexWriter)
          );
        } else if (aiRes.status !== 401) {
          setAiError("Failed to load AI settings");
        }

        // Don't block first paint on local CLI probing (can be slow / hang some browsers).
        void refreshCliStatus();
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
    // Resolve against the same list AiModelField renders from, or the UI shows
    // one effort while state holds another.
    const options = isCliProvider(provider)
      ? cliOptionsFor(provider, cliStatus?.models)
      : null;
    const nextModel = options?.[0]?.id || defaultModelForProvider(provider);
    const nextEffort = options
      ? resolveEffortForModel(options, nextModel)
      : null;

    const updater = (prev: AiModelFormState): AiModelFormState => ({
      ...prev,
      provider,
      model: nextModel,
      effort: nextEffort,
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
        effort: isCliProvider(buildFixModel.provider)
          ? buildFixModel.effort
          : null,
        endpoint: buildFixModel.endpoint.trim() || null,
      };
      const latexWriterPayload: Record<string, unknown> = {
        provider: latexWriterModel.provider,
        model: latexWriterModel.model.trim(),
        effort: isCliProvider(latexWriterModel.provider)
          ? latexWriterModel.effort
          : null,
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
        // No `enabled` key: this form only edits models, so the server keeps
        // whatever the user set elsewhere.
        body: JSON.stringify({
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
      const models = cliStatus?.models ?? null;
      setBuildFixModel(normalizeCliOnlyModelState(saved.buildFix, models));
      setLatexWriterModel(normalizeCliOnlyModelState(saved.latexWriter, models));

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
        <p className="text-text-secondary">Redirecting to sign in…</p>
        <Link
          href="/login?redirect=%2Fdashboard%2Fsettings"
          className="mt-4 text-sm text-accent hover:text-accent-hover transition-colors"
        >
          Continue to sign in
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
                  effort={buildFixModel.effort}
                  cliModels={cliStatus?.models ?? null}
                  onModelChange={(value, nextEffort) =>
                    setBuildFixModel((prev) => ({
                      ...prev,
                      model: value,
                      effort: nextEffort,
                    }))
                  }
                  onEffortChange={(value) =>
                    setBuildFixModel((prev) => ({ ...prev, effort: value }))
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
                  effort={latexWriterModel.effort}
                  cliModels={cliStatus?.models ?? null}
                  onModelChange={(value, nextEffort) =>
                    setLatexWriterModel((prev) => ({
                      ...prev,
                      model: value,
                      effort: nextEffort,
                    }))
                  }
                  onEffortChange={(value) =>
                    setLatexWriterModel((prev) => ({ ...prev, effort: value }))
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
