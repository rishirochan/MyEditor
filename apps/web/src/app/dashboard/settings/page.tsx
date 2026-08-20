"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  Loader2,
  Check,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Sparkles,
  RefreshCw,
  Terminal,
} from "lucide-react";
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

/* ─── Page primitives ───────────────────────────────────────
   Three tiny local components so every section, field, and
   banner on this page shares one rhythm. */

function Section({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-5 border-t border-border-subtle pt-8 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-10">
      <div className="md:sticky md:top-8 md:self-start">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
          {icon}
          {title}
        </h2>
        <p className="mt-1.5 max-w-[42ch] text-sm text-text-secondary">
          {description}
        </p>
      </div>
      <div className="min-w-0 space-y-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium tracking-wide text-text-muted uppercase"
      >
        {label}
      </label>
      {children}
      {hint ? (
        <p className="max-w-[70ch] text-xs text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/* Feedback never rides on hue alone: icon + text carry the state. */
function Notice({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: ReactNode;
}) {
  const Icon = tone === "success" ? CheckCircle2 : AlertCircle;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm",
        tone === "success"
          ? "bg-success-subtle text-success"
          : "bg-error-subtle text-error"
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
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
        className="input"
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
        <SelectTrigger className="w-full bg-bg-inset">
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
        <div className="space-y-1.5">
          <span className="block text-xs font-medium tracking-wide text-text-muted uppercase">
            Intelligence
          </span>
          <div
            role="radiogroup"
            aria-label="Intelligence level"
            className="flex flex-wrap gap-1 rounded-lg border border-border bg-bg-inset p-1"
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
                    "min-w-[3.25rem] flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors duration-150",
                    selectedEffort
                      ? "bg-accent text-accent-fg"
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
        signal: AbortSignal.timeout(20_000),
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

  const emailChanged =
    email.trim().toLowerCase() !== user.email.toLowerCase();

  // Both purposes render the identical provider → model → credentials
  // chain, so they are one template rather than two copies that drift.
  const purposes: {
    key: "buildFix" | "latexWriter";
    title: string;
    description: string;
    state: AiModelFormState;
    setState: (updater: (prev: AiModelFormState) => AiModelFormState) => void;
  }[] = [
    {
      key: "buildFix",
      title: "Build fix",
      description: "Runs behind Fix with AI in the build log.",
      state: buildFixModel,
      setState: setBuildFixModel,
    },
    {
      key: "latexWriter",
      title: "LaTeX writer",
      description: "Runs the writing and generation actions in the editor.",
      state: latexWriterModel,
      setState: setLatexWriterModel,
    },
  ];

  return (
    <div className="space-y-8">
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

      <header>
        <h1 className="text-2xl font-semibold text-text-primary">Settings</h1>
        <p className="mt-1.5 max-w-[70ch] text-sm text-text-secondary">
          Your account details, and the models MyEditor runs for each AI task.
          Changes apply to every project on this account.
        </p>
      </header>

      <Section
        title="Account"
        description="Your name and the address you sign in with."
      >
        {profileError && <Notice tone="error">{profileError}</Notice>}
        {profileSuccess && <Notice tone="success">{profileSuccess}</Notice>}

        <form onSubmit={onProfileSubmit} className="space-y-5">
          <Field label="Name" htmlFor="name">
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={255}
              className="input"
            />
          </Field>

          <Field
            label="Email"
            htmlFor="email"
            hint="Used to sign in. Changing it requires your current password."
          >
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input"
            />
          </Field>

          {emailChanged && (
            <p className="flex items-start gap-2 rounded-lg bg-warning-subtle px-3 py-2.5 text-sm text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Saving will change the address on your account. You will be
                asked for your current password to confirm.
              </span>
            </p>
          )}

          <div className="border-t border-border-subtle pt-5">
            <button
              type="submit"
              disabled={profileSaving}
              className="btn btn-primary px-4 py-2.5"
            >
              {profileSaving && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              {profileSaving ? "Saving" : "Save account"}
            </button>
          </div>
        </form>
      </Section>

      <Section
        title="AI models"
        icon={<Sparkles className="h-4 w-4 text-accent" />}
        description="Each AI task picks its own provider and model. Providers run through a CLI on this machine, so a provider is only usable once its CLI is signed in."
      >
        {aiError && <Notice tone="error">{aiError}</Notice>}
        {aiSuccess && <Notice tone="success">{aiSuccess}</Notice>}

        <form onSubmit={saveAiSettings} className="space-y-8">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  1. Provider access
                </h3>
              </div>
              <button
                type="button"
                onClick={() => void refreshCliStatus()}
                disabled={cliStatusLoading}
                className="btn btn-secondary"
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    cliStatusLoading && "animate-spin"
                  )}
                />
                Refresh
              </button>
            </div>

            {cliMessage && (
              <p className="text-xs text-text-secondary">{cliMessage}</p>
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
                // Status is never hue alone: icon and words carry it too.
                const StateIcon = !status
                  ? Loader2
                  : ready
                    ? Check
                    : status.installed
                      ? AlertTriangle
                      : AlertCircle;
                const stateLabel = !status
                  ? "Checking"
                  : !status.installed
                    ? "Not installed"
                    : status.authenticated
                      ? "Signed in"
                      : "Not signed in";
                const stateTone = !status
                  ? "text-text-muted"
                  : ready
                    ? "text-success"
                    : status.installed
                      ? "text-warning"
                      : "text-text-muted";

                return (
                  <div key={key} className="panel space-y-2.5 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-text-primary">
                        {label}
                      </p>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 text-xs font-medium",
                          stateTone
                        )}
                      >
                        <StateIcon
                          className={cn(
                            "h-3.5 w-3.5",
                            !status && "animate-spin"
                          )}
                        />
                        {stateLabel}
                      </span>
                    </div>

                    <p className="font-mono text-xs break-all text-text-muted">
                      {status?.email ||
                        status?.binaryPath ||
                        status?.detail ||
                        "Not detected"}
                    </p>

                    {status?.subscriptionType && status.authenticated && (
                      <p className="text-xs text-text-muted">
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
                        className="btn btn-secondary"
                      >
                        {cliLoginBusy === provider ? "Opening" : "Sign in"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                2. Model per task
              </h3>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {purposes.map((purpose) => (
                <div key={purpose.key} className="panel space-y-4 p-4">
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary">
                      {purpose.title}
                    </h4>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      {purpose.description}
                    </p>
                  </div>

                  <Field label="Provider">
                    <Select
                      value={purpose.state.provider}
                      onValueChange={(value) =>
                        onProviderChange(purpose.key, value as AiProvider)
                      }
                    >
                      <SelectTrigger className="w-full bg-bg-inset">
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
                  </Field>

                  <Field label="Model">
                    <AiModelField
                      provider={purpose.state.provider}
                      model={purpose.state.model}
                      effort={purpose.state.effort}
                      cliModels={cliStatus?.models ?? null}
                      onModelChange={(value, nextEffort) =>
                        purpose.setState((prev) => ({
                          ...prev,
                          model: value,
                          effort: nextEffort,
                        }))
                      }
                      onEffortChange={(value) =>
                        purpose.setState((prev) => ({
                          ...prev,
                          effort: value,
                        }))
                      }
                    />
                  </Field>

                  {!isCliProvider(purpose.state.provider) && (
                    <>
                      <Field
                        label="Endpoint URL"
                        hint="Leave blank to use the provider default."
                      >
                        <input
                          type="url"
                          value={purpose.state.endpoint}
                          onChange={(e) =>
                            purpose.setState((prev) => ({
                              ...prev,
                              endpoint: e.target.value,
                            }))
                          }
                          className="input"
                          placeholder={
                            purpose.state.provider === "custom"
                              ? "https://your-host/v1"
                              : "Optional override"
                          }
                        />
                      </Field>

                      <Field
                        label="API key"
                        hint="Saved encrypted to your account. Leave blank to keep the stored key, or to fall back to the server key if one is configured."
                      >
                        <PasswordInput
                          value={purpose.state.apiKey}
                          onChange={(e) =>
                            purpose.setState((prev) => ({
                              ...prev,
                              apiKey: e.target.value,
                            }))
                          }
                          className="bg-bg-inset"
                          placeholder={
                            purpose.state.apiKeySet
                              ? "Stored key exists, leave blank to keep"
                              : "sk-..."
                          }
                        />
                      </Field>
                    </>
                  )}

                  {isCliProvider(purpose.state.provider) && (
                    <p className="flex items-start gap-2 rounded-lg bg-bg-inset px-3 py-2 text-xs text-text-secondary">
                      <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
                      <span>
                        Uses the local{" "}
                        {providerLabel(purpose.state.provider)} sign-in above.
                        No API key or endpoint needed.
                      </span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-border-subtle pt-5">
            <button
              type="submit"
              disabled={aiSaving}
              className="btn btn-primary px-4 py-2.5"
            >
              {aiSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {aiSaving ? "Saving" : "Save AI settings"}
            </button>
          </div>
        </form>
      </Section>
    </div>
  );
}
