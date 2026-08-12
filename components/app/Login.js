"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/appapi";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Eye,
  EyeOff,
  Loader2,
  LogIn,
  Moon,
  ShieldCheck,
  Sun,
  User,
  Wrench,
} from "lucide-react";

const QUICK_LOGIN_ENABLED =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_ENABLE_QUICK_LOGIN === "true";

const QUICK_LOGIN_ROLES = [
  {
    role: "employee",
    label: "Employee",
    hint: "Raise tickets",
    initials: "EM",
    icon: User,
    tone: "bg-slate-500",
  },
  {
    role: "it",
    label: "IT team",
    hint: "Agent view",
    initials: "IT",
    icon: Wrench,
    tone: "bg-blue-600",
  },
  {
    role: "admin",
    label: "Admin team",
    hint: "Agent view",
    initials: "AD",
    icon: Building2,
    tone: "bg-emerald-600",
  },
  {
    role: "super_admin",
    label: "Super admin",
    hint: "Full access",
    initials: "SA",
    icon: ShieldCheck,
    tone: "bg-fuchsia-700",
  },
];

const ROLE_OPTIONS = [
  { value: "employee", label: "Employee", hint: "Raise tickets", icon: User },
  { value: "it", label: "IT team", hint: "Needs approval", icon: Wrench },
  {
    value: "admin",
    label: "Admin team",
    hint: "Needs approval",
    icon: Building2,
  },
];

const INPUT_CLASS =
  "h-11 rounded-lg border-[var(--login-border)] bg-[var(--login-input)] px-4 text-[var(--login-text)] shadow-none placeholder:text-[var(--login-placeholder)] focus-visible:border-[#ED00ED]/70 focus-visible:ring-2 focus-visible:ring-[#ED00ED]/20";

function BrandLockup({ compact = false, context = "signin" }) {
  return (
    <div className={`flex items-center ${compact ? "gap-3" : "gap-5 sm:gap-6"}`}>
      <Image
        src={
          compact
            ? "/brand/ethara-emblem.png"
            : `/brand/ethara-mark-animation.svg?ctx=${context}`
        }
        alt="Ethara.AI"
        width={compact ? 52 : 218}
        height={compact ? 52 : 216}
        priority
        unoptimized={!compact}
        draggable={false}
        style={compact ? undefined : { height: "auto" }}
        className={`login-brand-logo ${compact ? "h-12 w-12" : "login-hero-mark h-auto w-[132px] xl:w-[150px]"} shrink-0 select-none object-contain`}
      />
      <span
        className={`login-wordmark-label ${compact ? "text-2xl" : "login-wordmark-text text-5xl xl:text-6xl"} whitespace-nowrap font-semibold tracking-tight text-[var(--login-brand-text)]`}
      >
        Ethara<span className="text-[#ED00ED]">.AI</span>
      </span>
    </div>
  );
}

function BrandPanel({ mode }) {
  return (
    <aside className="login-brand-panel relative hidden min-h-screen items-center justify-center overflow-hidden border-r border-[var(--login-brand-border)] lg:flex lg:h-screen">
      <div className="login-gradient-mesh pointer-events-none absolute inset-0" />
      <div className="login-grid-plane pointer-events-none absolute inset-0" />
      <div className="login-signal-plane pointer-events-none absolute inset-0" />
      <div className="login-accent-line pointer-events-none absolute left-0 top-1/2 h-px w-4/5" />
      <div className="relative z-10 flex w-full max-w-[540px] justify-center px-10">
        <div className="login-brand-stage">
          <BrandLockup context={mode === "register" ? "register" : "signin"} />
        </div>
      </div>
      <p className="absolute bottom-8 left-0 right-0 text-center text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--login-footer)]">
        Ethara Service Hub · IT &amp; Admin Operations
      </p>
    </aside>
  );
}

function Field({ label, htmlFor, right, children }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label
          htmlFor={htmlFor}
          className="text-[13px] font-medium text-[var(--login-label)]"
        >
          {label}
        </Label>
        {right}
      </div>
      {children}
    </div>
  );
}

function QuickLogin({ loadingRole, onSelect }) {
  return (
    <div>
      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--login-divider)]" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--login-faint)]">
          Quick login
        </span>
        <span className="h-px flex-1 bg-[var(--login-divider)]" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {QUICK_LOGIN_ROLES.map((item) => (
          <button
            key={item.role}
            type="button"
            onClick={() => onSelect(item.role)}
            disabled={Boolean(loadingRole)}
            className="rounded-lg border border-[var(--login-border)] bg-[var(--login-option)] px-2 py-2.5 text-center transition duration-200 hover:-translate-y-0.5 hover:border-[#ED00ED]/55 hover:bg-[#ED00ED]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ED00ED]/45 disabled:pointer-events-none disabled:opacity-60"
          >
            <span
              className={`mx-auto grid h-8 w-8 place-items-center rounded-full text-[10px] font-bold text-white ${item.tone}`}
            >
              {loadingRole === item.role ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                item.initials
              )}
            </span>
            <b className="mt-2 block truncate text-[10px] font-semibold text-[var(--login-text-soft)]">
              {item.label}
            </b>
            <span className="mt-0.5 block truncate text-[9px] text-[var(--login-faint)]">
              {item.hint}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-center text-[10px] text-[var(--login-placeholder)]">
        Development fixture access · no password is exposed
      </p>
    </div>
  );
}

export default function Login({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [appearance, setAppearance] = useState("light");
  const [loading, setLoading] = useState(false);
  const [quickLoginRole, setQuickLoginRole] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [remember, setRemember] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [login, setLogin] = useState({ email: "", password: "" });
  const [reg, setReg] = useState({
    name: "",
    email: "",
    password: "",
    confirm: "",
    role: "employee",
  });

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("ethara-login-appearance");
      if (saved === "light" || saved === "dark") setAppearance(saved);
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
    const verification = new URLSearchParams(window.location.search).get(
      "emailVerification",
    );
    if (verification === "success")
      toast.success("Email verified. You can now sign in.");
    else if (verification === "approval-pending")
      toast.success("Email verified. Your account is awaiting approval.");
    else if (verification === "invalid")
      toast.error("This verification link is invalid or has expired.");
    if (verification) {
      const url = new URL(window.location.href);
      url.searchParams.delete("emailVerification");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  const toggleAppearance = () => {
    setAppearance((current) => {
      const next = current === "light" ? "dark" : "light";
      try {
        window.localStorage.setItem("ethara-login-appearance", next);
      } catch {
        // The visual switch still works even when persistence is unavailable.
      }
      return next;
    });
  };

  const emailValid = reg.email.toLowerCase().endsWith("@ethara.ai");
  const passwordsMatch = Boolean(reg.confirm) && reg.password === reg.confirm;
  const strength = useMemo(() => {
    let score = 0;
    if (reg.password.length >= 8) score++;
    if (/[A-Z]/.test(reg.password) && /[a-z]/.test(reg.password)) score++;
    if (/\d/.test(reg.password)) score++;
    if (/[^A-Za-z0-9]/.test(reg.password)) score++;
    return score;
  }, [reg.password]);

  const doLogin = async (event) => {
    event?.preventDefault();
    setLoading(true);
    try {
      const { user } = await api("/auth/login", {
        method: "POST",
        body: login,
      });
      toast.success(`Welcome, ${user.name}`);
      onLogin(user);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const doRegister = async (event) => {
    event?.preventDefault();
    if (!emailValid) return toast.error("Please use your @ethara.ai email");
    if (reg.password.length < 8)
      return toast.error("Password must be at least 8 characters");
    if (!passwordsMatch) return toast.error("Passwords do not match");
    if (!accepted)
      return toast.error("Please accept the acceptable use policy");
    setLoading(true);
    try {
      const result = await api("/auth/register", {
        method: "POST",
        body: {
          name: reg.name,
          email: reg.email,
          password: reg.password,
          role: reg.role,
        },
      });
      if (result.pending) {
        toast.success(result.message);
        setMode("login");
        setLogin({ email: reg.email, password: "" });
      } else {
        toast.success(`Account created. Welcome, ${result.user.name}!`);
        onLogin(result.user);
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const doQuickLogin = async (role) => {
    setQuickLoginRole(role);
    try {
      const { user } = await api("/auth/quick-login", {
        method: "POST",
        body: { role },
      });
      toast.success(`Welcome, ${user.name}`);
      onLogin(user);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setQuickLoginRole(null);
    }
  };

  return (
    <div
      className="login-page-shell grid min-h-screen bg-[var(--login-page-bg)] text-[var(--login-text)] lg:h-screen lg:grid-cols-[0.95fr_1.05fr] lg:overflow-hidden"
      data-login-theme={appearance}
    >
      <BrandPanel mode={mode} />
      <main className="login-form-panel relative flex min-h-screen min-w-0 w-full items-center justify-center overflow-x-hidden px-4 py-8 sm:px-8 sm:py-10 lg:h-screen lg:overflow-y-auto">
        <button
          type="button"
          onClick={toggleAppearance}
          className="login-theme-toggle absolute right-4 top-4 z-20 inline-flex h-9 items-center gap-2 rounded-full border border-[var(--login-border)] bg-[var(--login-option)] px-3 text-xs font-semibold text-[var(--login-muted)] shadow-sm transition hover:border-[#ED00ED]/40 hover:text-[#ED00ED] sm:right-6 sm:top-6"
          aria-label={`Switch to ${appearance === "light" ? "dark" : "light"} mode`}
        >
          {appearance === "light" ? (
            <Moon className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">
            {appearance === "light" ? "Dark" : "Light"}
          </span>
        </button>
        <div className="login-mobile-glow pointer-events-none absolute inset-0 lg:hidden" />
        <div className="login-grid-plane pointer-events-none absolute inset-0 opacity-60 lg:hidden" />
        <div
          className={`relative z-10 min-w-0 w-full max-w-full ${mode === "login" ? "sm:max-w-[500px]" : "sm:max-w-[520px]"}`}
        >
          <div className="mb-6 flex justify-center lg:hidden">
            <BrandLockup compact context={mode === "register" ? "register" : "signin"} />
          </div>
          <section className="login-auth-card w-full max-w-full rounded-xl border border-[var(--login-card-border)] bg-[var(--login-card)] p-5 shadow-[var(--login-card-shadow)] backdrop-blur-xl sm:p-8">
            {mode === "login" ? (
              <>
                <div className="mb-6">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#ED00ED]">
                    Ethara Service Hub
                  </p>
                  <h1 className="text-2xl font-semibold tracking-tight text-[var(--login-text)] sm:text-[28px]">
                    Sign in
                  </h1>
                  <p className="mt-2 text-sm text-[var(--login-muted)]">
                    Access IT, Admin, ticketing and service operations.
                  </p>
                </div>

                <form onSubmit={doLogin} className="space-y-5">
                  <Field label="Email" htmlFor="login-email">
                    <Input
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      className={INPUT_CLASS}
                      value={login.email}
                      onChange={(event) =>
                        setLogin({ ...login, email: event.target.value })
                      }
                      placeholder="you@ethara.ai"
                      disabled={loading}
                      required
                    />
                  </Field>
                  <Field
                    label="Password"
                    htmlFor="login-password"
                    right={
                      <button
                        type="button"
                        onClick={() =>
                          toast.info(
                            "Contact your super admin to reset your password",
                          )
                        }
                        className="text-xs font-medium text-[#ED00ED]/80 transition hover:text-[#FF39FF]"
                      >
                        Forgot password?
                      </button>
                    }
                  >
                    <div className="relative">
                      <Input
                        id="login-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        className={`${INPUT_CLASS} pr-11`}
                        value={login.password}
                        onChange={(event) =>
                          setLogin({ ...login, password: event.target.value })
                        }
                        placeholder="••••••••"
                        disabled={loading}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((value) => !value)}
                        className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-[var(--login-icon)] transition hover:bg-[#ED00ED]/[0.06] hover:text-[var(--login-icon-hover)]"
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </Field>
                  <label className="flex cursor-pointer items-center gap-2.5 text-xs text-[var(--login-muted)]">
                    <Checkbox
                      checked={remember}
                      onCheckedChange={(value) =>
                        setRemember(Boolean(value))
                      }
                      className="border-[var(--login-checkbox)] data-[state=checked]:border-[#ED00ED] data-[state=checked]:bg-[#ED00ED]"
                    />
                    Keep me signed in on this device
                  </label>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="login-submit-button h-11 w-full rounded-lg border-0 bg-[linear-gradient(135deg,#ED00ED_0%,#B84EDC_55%,#908DCE_100%)] font-semibold text-white shadow-[0_12px_26px_rgba(0,0,0,0.24)] hover:brightness-110"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      <>
                        <LogIn className="h-4 w-4" />
                        Sign in
                      </>
                    )}
                  </Button>
                </form>

                {QUICK_LOGIN_ENABLED && (
                  <QuickLogin
                    loadingRole={quickLoginRole}
                    onSelect={doQuickLogin}
                  />
                )}

                <div className="mt-6 border-t border-[var(--login-divider)] pt-5 text-sm text-[var(--login-muted)]">
                  New to the portal?{" "}
                  <button
                    type="button"
                    onClick={() => setMode("register")}
                    className="font-semibold text-[#ED00ED] transition hover:text-[#FF39FF]"
                  >
                    Create an account
                  </button>
                </div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-[var(--login-muted)] transition hover:text-[#ED00ED]"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to sign in
                </button>
                <div className="mb-6">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#ED00ED]">
                    Secure onboarding
                  </p>
                  <h1 className="text-2xl font-semibold tracking-tight text-[var(--login-text)] sm:text-[28px]">
                    Create your account
                  </h1>
                  <p className="mt-2 text-sm text-[var(--login-muted)]">
                    Only <b className="text-[var(--login-icon-hover)]">@ethara.ai</b> email
                    addresses can register.
                  </p>
                </div>

                <form onSubmit={doRegister} className="space-y-4">
                  <Field label="Full name" htmlFor="register-name">
                    <Input
                      id="register-name"
                      className={INPUT_CLASS}
                      value={reg.name}
                      onChange={(event) =>
                        setReg({ ...reg, name: event.target.value })
                      }
                      placeholder="Your full name"
                      disabled={loading}
                      required
                    />
                  </Field>
                  <Field label="Company email" htmlFor="register-email">
                    <div className="relative">
                      <Input
                        id="register-email"
                        type="email"
                        autoComplete="email"
                        className={`${INPUT_CLASS} pr-11`}
                        value={reg.email}
                        onChange={(event) =>
                          setReg({ ...reg, email: event.target.value })
                        }
                        placeholder="you@ethara.ai"
                        disabled={loading}
                        required
                      />
                      {reg.email && (
                        <span
                          className={`absolute right-3 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center ${emailValid ? "text-emerald-400" : "text-red-400"}`}
                        >
                          {emailValid ? <Check className="h-4 w-4" /> : "×"}
                        </span>
                      )}
                    </div>
                  </Field>

                  <div>
                    <Label className="text-[13px] font-medium text-[var(--login-label)]">
                      I&apos;m joining as
                    </Label>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {ROLE_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        const active = reg.role === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() =>
                              setReg({ ...reg, role: option.value })
                            }
                            aria-pressed={active}
                            className={`rounded-lg border p-3 text-center transition ${
                              active
                                ? "border-[#ED00ED]/70 bg-[#ED00ED]/10"
                                : "border-[var(--login-border)] bg-[var(--login-option)] hover:border-[#ED00ED]/40"
                            }`}
                          >
                            <Icon
                              className={`mx-auto h-5 w-5 ${active ? "text-[#ED00ED]" : "text-[var(--login-muted)]"}`}
                            />
                            <b className="mt-2 block text-[11px] text-[var(--login-text-soft)]">
                              {option.label}
                            </b>
                            <span className="text-[9px] text-[var(--login-faint)]">
                              {option.hint}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[10px] leading-4 text-[var(--login-faint)]">
                      Team roles require super-admin approval. Employee access
                      is activated immediately.
                    </p>
                  </div>

                  <Field label="Password" htmlFor="register-password">
                    <div className="relative">
                      <Input
                        id="register-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        className={`${INPUT_CLASS} pr-11`}
                        value={reg.password}
                        onChange={(event) =>
                          setReg({ ...reg, password: event.target.value })
                        }
                        placeholder="Minimum 8 characters"
                        disabled={loading}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((value) => !value)}
                        className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center text-[var(--login-icon)] hover:text-[var(--login-icon-hover)]"
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </Field>
                  <div>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map((level) => (
                        <span
                          key={level}
                          className={`h-1 flex-1 rounded-full ${
                            strength >= level
                              ? strength < 3
                                ? "bg-amber-400"
                                : "bg-emerald-400"
                              : "bg-[var(--login-border)]"
                          }`}
                        />
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] text-[var(--login-faint)]">
                      {strength >= 4
                        ? "Strong password"
                        : "Use 8+ characters, uppercase, a number and a symbol."}
                    </p>
                  </div>

                  <Field label="Confirm password" htmlFor="register-confirm">
                    <div className="relative">
                      <Input
                        id="register-confirm"
                        type={showConfirm ? "text" : "password"}
                        autoComplete="new-password"
                        className={`${INPUT_CLASS} pr-16`}
                        value={reg.confirm}
                        onChange={(event) =>
                          setReg({ ...reg, confirm: event.target.value })
                        }
                        placeholder="Repeat your password"
                        disabled={loading}
                        required
                      />
                      {reg.confirm && (
                        <span
                          className={`absolute right-10 top-1/2 -translate-y-1/2 ${passwordsMatch ? "text-emerald-400" : "text-red-400"}`}
                        >
                          {passwordsMatch ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            "×"
                          )}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowConfirm((value) => !value)}
                        className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center text-[var(--login-icon)] hover:text-[var(--login-icon-hover)]"
                        aria-label={
                          showConfirm ? "Hide password" : "Show password"
                        }
                      >
                        {showConfirm ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </Field>

                  <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-5 text-[var(--login-muted)]">
                    <Checkbox
                      className="mt-0.5 border-[var(--login-checkbox)] data-[state=checked]:border-[#ED00ED] data-[state=checked]:bg-[#ED00ED]"
                      checked={accepted}
                      onCheckedChange={(value) =>
                        setAccepted(Boolean(value))
                      }
                    />
                    <span>
                      I agree to the{" "}
                      <span className="font-semibold text-[#ED00ED]">
                        acceptable use policy
                      </span>{" "}
                      and understand tickets are logged for audit.
                    </span>
                  </label>

                  <Button
                    type="submit"
                    disabled={loading}
                    className="login-submit-button h-11 w-full rounded-lg border-0 bg-[linear-gradient(135deg,#ED00ED_0%,#B84EDC_55%,#908DCE_100%)] font-semibold text-white hover:brightness-110"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        Create account <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>

              </>
            )}
          </section>
          <p className="mt-5 text-center text-[10px] uppercase tracking-[0.16em] text-[var(--login-footer)] lg:hidden">
            Ethara Service Hub · Secure internal access
          </p>
        </div>
      </main>
    </div>
  );
}
