"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
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
  KeyRound,
  Loader2,
  LogIn,
  MailCheck,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
} from "lucide-react";

const WORK_LOCATIONS = [
  { value: "Tulip", site: "HQ2" },
  { value: "Lotus", site: "HQ" },
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

export default function Login({ onLogin }) {
  const [mode, setMode] = useState("login");
  // The sign-in screen shares the platform theme so the choice made here
  // carries straight into the dashboard. `resolvedTheme` is unknown until the
  // client mounts, so keep the previous light default for the first paint to
  // avoid a hydration mismatch.
  const { resolvedTheme, setTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  const appearance = themeMounted && resolvedTheme === "dark" ? "dark" : "light";
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [remember, setRemember] = useState(false);
  const [login, setLogin] = useState({
    email: "",
    employee_id: "",
    password: "",
  });
  const [forgot, setForgot] = useState({
    email: "",
    employee_id: "",
  });
  const [otp, setOtp] = useState({
    code: "",
    maskedEmail: "",
    expiresAt: 0,
    resendAt: 0,
    deliveryState: "sent",
  });
  const [otpClock, setOtpClock] = useState(() => Date.now());
  const [reg, setReg] = useState({
    name: "",
    email: "",
    employee_id: "",
    password: "",
    confirm: "",
    role: "employee",
    location: "Tulip",
  });

  useEffect(() => {
    setThemeMounted(true);
    try {
      // One-time migration of the old sign-in-only preference onto the shared
      // platform theme key, so returning users keep the mode they picked.
      const saved = window.localStorage.getItem("ethara-login-appearance");
      if (
        (saved === "light" || saved === "dark") &&
        !window.localStorage.getItem("ethara-theme")
      ) {
        setTheme(saved);
      }
      if (saved) window.localStorage.removeItem("ethara-login-appearance");
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
    const verification = new URLSearchParams(window.location.search).get(
      "emailVerification",
    );
    if (verification === "success")
      toast.success("Email verified. You can now sign in.");
    else if (verification === "invalid")
      toast.error("This verification link is invalid or has expired.");
    if (verification) {
      const url = new URL(window.location.href);
      url.searchParams.delete("emailVerification");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
    // Runs once on mount; setTheme is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode !== "otp") return undefined;
    setOtpClock(Date.now());
    const timer = window.setInterval(() => setOtpClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [mode]);

  const toggleAppearance = () => {
    // Persistence is handled by the shared ThemeProvider (storageKey
    // "ethara-theme"), so the choice survives into the dashboard.
    const next = appearance === "light" ? "dark" : "light";
    const root = document.documentElement;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) {
      setTheme(next);
      return;
    }
    root.classList.add("theme-transitioning");
    setTheme(next);
    window.setTimeout(() => root.classList.remove("theme-transitioning"), 320);
  };

  const emailValid = reg.email.toLowerCase().endsWith("@ethara.ai");
  const passwordsMatch = Boolean(reg.confirm) && reg.password === reg.confirm;
  const strength = useMemo(() => {
    let score = 0;
    if (reg.password.length >= 12) score++;
    if (/[A-Z]/.test(reg.password) && /[a-z]/.test(reg.password)) score++;
    if (/\d/.test(reg.password)) score++;
    if (/[^A-Za-z0-9]/.test(reg.password)) score++;
    return score;
  }, [reg.password]);

  const doLogin = async (event) => {
    event?.preventDefault();
    setLoading(true);
    try {
      const result = await api("/auth/login", {
        method: "POST",
        body: { ...login, remember },
      });
      if (result.otp_required) {
        const now = Date.now();
        setOtp({
          code: "",
          maskedEmail: result.masked_email,
          expiresAt: now + Number(result.expires_in || 600) * 1000,
          resendAt: now + Number(result.resend_after || 60) * 1000,
          deliveryState: result.delivery_state || "sent",
        });
        setMode("otp");
        toast.success("Verification code sent to your company email");
        return;
      }
      const { user } = result;
      toast.success(`Welcome, ${user.name}`);
      onLogin(user);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (event) => {
    event?.preventDefault();
    if (!/^\d{6}$/.test(otp.code))
      return toast.error("Enter the complete 6-digit code");
    setLoading(true);
    try {
      const { user } = await api("/auth/login/otp/verify", {
        method: "POST",
        body: { code: otp.code },
      });
      toast.success(`Identity confirmed. Welcome, ${user.name}`);
      onLogin(user);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    if (otp.resendAt > Date.now()) return;
    setLoading(true);
    try {
      const result = await api("/auth/login/otp/resend", {
        method: "POST",
      });
      const now = Date.now();
      setOtp((current) => ({
        ...current,
        code: "",
        maskedEmail: result.masked_email || current.maskedEmail,
        expiresAt: now + Number(result.expires_in || 600) * 1000,
        resendAt: now + Number(result.resend_after || 60) * 1000,
        deliveryState: result.delivery_state || "sent",
      }));
      toast.success("A new verification code was sent");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const leaveOtp = () => {
    setMode("login");
    setOtp((current) => ({ ...current, code: "" }));
    setLogin((current) => ({ ...current, password: "" }));
  };

  const doForgot = async (event) => {
    event?.preventDefault();
    setLoading(true);
    try {
      const result = await api("/auth/password-reset-request", {
        method: "POST",
        body: forgot,
      });
      toast.success(
        result.message ||
          "Your reset request has been sent to the Super Admin.",
      );
      setMode("login");
      setLogin((current) => ({
        ...current,
        email: forgot.email,
        password: "",
      }));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const otpSeconds = Math.max(
    0,
    Math.ceil((Number(otp.expiresAt) - otpClock) / 1000),
  );
  const resendSeconds = Math.max(
    0,
    Math.ceil((Number(otp.resendAt) - otpClock) / 1000),
  );
  const otpTime = `${String(Math.floor(otpSeconds / 60)).padStart(2, "0")}:${String(otpSeconds % 60).padStart(2, "0")}`;

  const doRegister = async (event) => {
    event?.preventDefault();
    if (!emailValid) return toast.error("Please use your @ethara.ai email");
    if (reg.password.length < 12)
      return toast.error("Password must be at least 12 characters");
    if (
      !/[a-z]/.test(reg.password) ||
      !/[A-Z]/.test(reg.password) ||
      !/\d/.test(reg.password) ||
      !/[^A-Za-z0-9]/.test(reg.password)
    )
      return toast.error(
        "Password must include uppercase, lowercase, a number and a symbol",
      );
    if (!passwordsMatch) return toast.error("Passwords do not match");
    setLoading(true);
    try {
      const result = await api("/auth/register", {
        method: "POST",
        body: {
          name: reg.name,
          email: reg.email,
          employee_id: reg.employee_id,
          password: reg.password,
          role: reg.role,
          location: reg.location,
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

  return (
    <div
      className="login-page-shell grid min-h-screen bg-[var(--login-page-bg)] text-[var(--login-text)] lg:h-screen lg:grid-cols-[0.95fr_1.05fr] lg:overflow-hidden"
      data-login-theme={appearance}
    >
      <BrandPanel mode={mode} />
      <main className="login-form-panel relative flex min-h-screen min-w-0 w-full items-start justify-center overflow-x-hidden px-4 py-8 sm:px-8 sm:py-10 lg:h-screen lg:overflow-y-auto [@media(min-width:1024px)_and_(max-height:700px)]:py-16">
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
          className={`relative z-10 my-auto min-w-0 w-full max-w-full ${mode === "login" ? "sm:max-w-[500px]" : "sm:max-w-[520px]"}`}
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
                  <Field label="Employee ID" htmlFor="login-employee-id">
                    <Input
                      id="login-employee-id"
                      autoComplete="off"
                      className={INPUT_CLASS}
                      value={login.employee_id}
                      onChange={(event) =>
                        setLogin({ ...login, employee_id: event.target.value })
                      }
                      placeholder="e.g. EMP-1023"
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
                        onClick={() => {
                          setForgot({
                            email: login.email,
                            employee_id: login.employee_id,
                          });
                          setMode("forgot");
                        }}
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
            ) : mode === "otp" ? (
              <>
                <button
                  type="button"
                  onClick={leaveOtp}
                  className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-[var(--login-muted)] transition hover:text-[#ED00ED]"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to sign in
                </button>
                <div className="mb-6">
                  <span className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-[#ED00ED]/10 text-[#ED00ED]">
                    <MailCheck className="h-6 w-6" />
                  </span>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#ED00ED]">
                    Secure sign in
                  </p>
                  <h1 className="text-2xl font-semibold tracking-tight text-[var(--login-text)] sm:text-[28px]">
                    Check your email
                  </h1>
                  <p className="mt-2 text-sm leading-6 text-[var(--login-muted)]">
                    Enter the 6-digit code sent to{" "}
                    <b className="text-[var(--login-text-soft)]">
                      {otp.maskedEmail}
                    </b>
                    . The code is valid for 10 minutes and works once.
                  </p>
                </div>

                <form onSubmit={verifyOtp} className="space-y-5">
                  <Field
                    label="Verification code"
                    htmlFor="login-otp"
                    right={
                      <span
                        className={`text-xs font-semibold tabular-nums ${otpSeconds < 60 ? "text-amber-500" : "text-[var(--login-muted)]"}`}
                      >
                        {otpSeconds ? otpTime : "Expired"}
                      </span>
                    }
                  >
                    <Input
                      id="login-otp"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      maxLength={6}
                      className={`${INPUT_CLASS} h-14 text-center font-mono text-2xl font-semibold tracking-[0.45em]`}
                      value={otp.code}
                      onChange={(event) =>
                        setOtp((current) => ({
                          ...current,
                          code: event.target.value.replace(/\D/g, "").slice(0, 6),
                        }))
                      }
                      placeholder="000000"
                      disabled={loading || otpSeconds === 0}
                      aria-describedby="otp-security-note"
                      required
                    />
                  </Field>
                  <div
                    id="otp-security-note"
                    className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] p-3 text-xs leading-5 text-[var(--login-muted)]"
                  >
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <span>
                      Never share this code. Ethara support will not ask for it
                      over phone, chat, or email.
                    </span>
                  </div>
                  {otp.deliveryState === "queued" && (
                    <p className="rounded-lg border border-amber-400/25 bg-amber-400/[0.08] px-3 py-2 text-xs text-amber-600">
                      Your message is queued with the email provider. Delivery
                      may take a moment.
                    </p>
                  )}
                  <Button
                    type="submit"
                    disabled={loading || otp.code.length !== 6 || otpSeconds === 0}
                    className="login-submit-button h-11 w-full rounded-lg border-0 bg-[linear-gradient(135deg,#ED00ED_0%,#B84EDC_55%,#908DCE_100%)] font-semibold text-white shadow-[0_12px_26px_rgba(0,0,0,0.24)] hover:brightness-110"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="h-4 w-4" />
                        Verify &amp; sign in
                      </>
                    )}
                  </Button>
                </form>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--login-divider)] pt-5 text-xs text-[var(--login-muted)]">
                  <span>Didn&apos;t receive the email?</span>
                  <button
                    type="button"
                    onClick={resendOtp}
                    disabled={loading || resendSeconds > 0}
                    className="inline-flex items-center gap-1.5 font-semibold text-[#ED00ED] transition hover:text-[#FF39FF] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                    {resendSeconds
                      ? `Resend in ${resendSeconds}s`
                      : "Resend code"}
                  </button>
                </div>
              </>
            ) : mode === "forgot" ? (
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
                  <span className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-[#ED00ED]/10 text-[#ED00ED]">
                    <KeyRound className="h-6 w-6" />
                  </span>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#ED00ED]">
                    Account recovery
                  </p>
                  <h1 className="text-2xl font-semibold tracking-tight text-[var(--login-text)] sm:text-[28px]">
                    Forgot your password?
                  </h1>
                  <p className="mt-2 text-sm leading-6 text-[var(--login-muted)]">
                    Submit your details and the Super Admin will receive a
                    reset request. You will be able to sign in with the new
                    password they set for you.
                  </p>
                </div>

                <form onSubmit={doForgot} className="space-y-5">
                  <Field label="Email" htmlFor="forgot-email">
                    <Input
                      id="forgot-email"
                      type="email"
                      autoComplete="email"
                      className={INPUT_CLASS}
                      value={forgot.email}
                      onChange={(event) =>
                        setForgot({ ...forgot, email: event.target.value })
                      }
                      placeholder="you@ethara.ai"
                      disabled={loading}
                      required
                    />
                  </Field>
                  <Field
                    label="Employee ID"
                    htmlFor="forgot-employee-id"
                    right={
                      <span className="text-xs text-[var(--login-faint)]">
                        Optional
                      </span>
                    }
                  >
                    <Input
                      id="forgot-employee-id"
                      autoComplete="off"
                      className={INPUT_CLASS}
                      value={forgot.employee_id}
                      onChange={(event) =>
                        setForgot({
                          ...forgot,
                          employee_id: event.target.value,
                        })
                      }
                      placeholder="e.g. EMP-1023"
                      disabled={loading}
                    />
                  </Field>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="login-submit-button h-11 w-full rounded-lg border-0 bg-[linear-gradient(135deg,#ED00ED_0%,#B84EDC_55%,#908DCE_100%)] font-semibold text-white shadow-[0_12px_26px_rgba(0,0,0,0.24)] hover:brightness-110"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Sending request...
                      </>
                    ) : (
                      <>
                        <KeyRound className="h-4 w-4" />
                        Send reset request
                      </>
                    )}
                  </Button>
                </form>
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
                  <Field label="Employee ID" htmlFor="register-employee-id">
                    <Input
                      id="register-employee-id"
                      autoComplete="off"
                      className={INPUT_CLASS}
                      value={reg.employee_id}
                      onChange={(event) =>
                        setReg({ ...reg, employee_id: event.target.value })
                      }
                      placeholder="e.g. EMP-1023"
                      disabled={loading}
                      required
                    />
                  </Field>

                  <Field label="Work location" htmlFor="register-location">
                    <div
                      id="register-location"
                      className="grid grid-cols-2 gap-2"
                      role="group"
                      aria-label="Work location"
                    >
                      {WORK_LOCATIONS.map((location) => (
                        <button
                          key={location.value}
                          type="button"
                          aria-pressed={reg.location === location.value}
                          disabled={loading}
                          onClick={() =>
                            setReg((current) => ({
                              ...current,
                              location: location.value,
                            }))
                          }
                          className={`flex min-h-12 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition ${
                            reg.location === location.value
                              ? "border-[#ED00ED]/70 bg-[#ED00ED]/10 text-[#ED00ED] ring-1 ring-[#ED00ED]/20"
                              : "border-[var(--login-border)] bg-[var(--login-option)] text-[var(--login-muted)] hover:border-[#ED00ED]/40"
                          }`}
                        >
                          <Building2 className="h-4 w-4" />
                          <span>{location.value}</span>
                          <span className="rounded-full border border-current/20 bg-white/50 px-2 py-0.5 text-[10px] font-bold tracking-wide">
                            {location.site}
                          </span>
                        </button>
                      ))}
                    </div>
                  </Field>

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
                        placeholder="Minimum 12 characters"
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
                        : "Use 12+ characters, uppercase, lowercase, a number and a symbol."}
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
