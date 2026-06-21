"use client";

import { useState, useEffect } from "react";
import { useSignIn, useSignUp, useClerk, useUser } from "@clerk/nextjs";
import Link from "next/link";

export default function CandidateAuthPage() {
  const { isLoaded: isSignInLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const { isLoaded: isSignUpLoaded, signUp, setActive: setSignUpActive } = useSignUp();
  const { signOut } = useClerk();
  const { user } = useUser();

  const [tab, setTab] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [code, setCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [resetMode, setResetMode] = useState<"none" | "forgot" | "verify">("none");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showResetNewPassword, setShowResetNewPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "admin_blocked") {
      setError("Unauthorized: Admin/HR users cannot log in to the Candidate Portal.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSignInLoaded) return;
    setLoading(true);
    setError("");

    try {
      const res = await signIn.create({
        identifier: form.email,
        password: form.password,
      });

      if (res.status === "complete") {
        try {
          const roleCheck = await fetch("/api/check-role", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: form.email }),
          });
          if (roleCheck.ok) {
            const { role } = await roleCheck.json();
            if (role && role !== "candidate") {
              setLoading(false);
              await signOut({ redirectUrl: window.location.pathname + "?error=admin_blocked" });
              return;
            }
          }
        } catch (roleErr) {
          console.error("Failed to check role:", roleErr);
        }

        await setSignInActive({ session: res.createdSessionId });
        window.location.href = "/candidate";
      } else {
        console.error("Candidate SignIn incomplete status:", res);
        setError("Sign in could not be completed. Please try again.");
      }
    } catch (err: any) {
      console.error("Candidate Clerk sign in error:", err);
      let errMsg = err.errors?.[0]?.message || err.message || "Invalid email or password";
      const errorCode = err.errors?.[0]?.code;
      if (
        errorCode === "active_session_already_exists" ||
        errMsg.toLowerCase().includes("session already exists")
      ) {
        errMsg = "Unauthorized: Admin/HR users cannot log in to the Candidate Portal.";
      }
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError("Passwords do not match");
      return;
    }
    if (!isSignUpLoaded) return;
    setLoading(true);
    setError("");

    try {
      const firstName = form.name.split(" ")[0] || form.name;
      const lastName = form.name.split(" ").slice(1).join(" ") || "";

      await signUp.create({
        emailAddress: form.email,
        password: form.password,
        firstName,
        lastName,
        unsafeMetadata: {
          role: "candidate",
        },
      });

      // Send verification code
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setPendingVerification(true);
    } catch (err: any) {
      console.error("Candidate Clerk sign up error:", err);
      setError(err.errors?.[0]?.message || "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSignUpLoaded) return;
    setLoading(true);
    setError("");

    try {
      const completeSignUp = await signUp.attemptEmailAddressVerification({
        code,
      });

      if (completeSignUp.status === "complete") {
        await setSignUpActive({ session: completeSignUp.createdSessionId });
        window.location.href = "/candidate";
      } else {
        console.error("Candidate verification incomplete status:", completeSignUp);
        setError("Verification could not be completed.");
      }
    } catch (err: any) {
      console.error("Candidate Clerk verification error:", err);
      let errMsg = err.errors?.[0]?.message || "Invalid verification code.";
      if (errMsg.toLowerCase().includes("is incorrect")) {
        errMsg = "Verification code is incorrect.";
      }
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (!isSignUpLoaded) return;
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setSuccess("A new verification code has been sent to your email.");
    } catch (err: any) {
      console.error("Candidate resend verification code error:", err);
      setError(err.errors?.[0]?.message || "Failed to resend code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleStartOver = () => {
    setPendingVerification(false);
    setError("");
    setSuccess("");
    setCode("");
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSignInLoaded) return;
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      await signIn.create({
        strategy: "reset_password_email_code",
        identifier: form.email,
      });
      setResetMode("verify");
      setSuccess("We sent a password reset code to your email.");
    } catch (err: any) {
      console.error("Candidate reset password request error:", err);
      setError(err.errors?.[0]?.message || "Failed to send reset code. Verify your email.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSignInLoaded) return;
    setError("");
    setLoading(true);

    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code: resetCode,
        password: newPassword,
      });

      if (result.status === "complete") {
        await setSignInActive({ session: result.createdSessionId });
        window.location.href = "/candidate";
      } else {
        setError("Password reset failed. Please try again.");
      }
    } catch (err: any) {
      console.error("Candidate password reset attempt error:", err);
      setError(err.errors?.[0]?.message || "Invalid reset code or weak password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-emerald-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-teal-600 rounded-2xl shadow-lg mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Candidate Portal</h1>
          <p className="text-sm text-gray-500 mt-1">Find your next opportunity</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          {!pendingVerification ? (
            <>
              {/* Tabs */}
              {resetMode === "none" && (
                <div className="flex border-b border-gray-100">
                  {(["login", "register"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => { setTab(t); setError(""); setSuccess(""); }}
                      className={`flex-1 py-3.5 text-sm font-semibold transition-colors ${
                        tab === t
                          ? "text-teal-700 border-b-2 border-teal-600 bg-teal-50/50"
                          : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      {t === "login" ? "Sign In" : "Create Account"}
                    </button>
                  ))}
                </div>
              )}

              <div className="p-6">
                {error && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700 flex items-center gap-2 animate-fade-in-down">
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    {error}
                  </div>
                )}
                {success && (
                  <div className="mb-4 p-3 bg-green-50 border border-green-100 rounded-lg text-sm text-green-700 flex items-center gap-2 animate-fade-in-down">
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {success}
                  </div>
                )}

                {tab === "login" ? (
                  resetMode === "none" ? (
                    <form onSubmit={handleLogin} className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                        <input
                          type="email" required autoComplete="email"
                          value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                          className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          placeholder="you@example.com"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <label className="block text-sm font-medium text-gray-700">Password</label>
                          <button
                            type="button"
                            onClick={() => { setError(""); setSuccess(""); setResetMode("forgot"); }}
                            className="text-xs text-teal-600 hover:text-teal-500 font-medium transition-colors"
                          >
                            Forgot Password?
                          </button>
                        </div>
                        <div className="relative">
                          <input
                            type={showLoginPassword ? "text" : "password"} required autoComplete="current-password"
                            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                            className="w-full px-3.5 py-2.5 pr-10 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                            placeholder="••••••••"
                          />
                          <button
                            type="button"
                            onClick={() => setShowLoginPassword(!showLoginPassword)}
                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
                          >
                            {showLoginPassword ? (
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                              </svg>
                            ) : (
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>
                      <button
                        type="submit" disabled={loading}
                        className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors text-sm"
                      >
                        {loading ? "Signing in…" : "Sign In"}
                      </button>
                    </form>
                  ) : resetMode === "forgot" ? (
                    <div className="space-y-4">
                      <div className="mb-4">
                        <h2 className="text-lg font-bold text-gray-900">Forgot Password</h2>
                        <p className="text-sm text-gray-500 mt-1">Enter your email and we'll send you a password reset code</p>
                      </div>
                      <form onSubmit={handleForgotPassword} className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                          <input
                            type="email" required
                            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                            className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                            placeholder="you@example.com"
                          />
                        </div>
                        <button
                          type="submit" disabled={loading}
                          className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors text-sm"
                        >
                          {loading ? "Sending Code…" : "Send Reset Code"}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setError(""); setSuccess(""); setResetMode("none"); }}
                          className="w-full text-center text-sm text-gray-500 hover:text-gray-700 transition-colors font-medium mt-2"
                        >
                          Back to Login
                        </button>
                      </form>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="mb-4">
                        <h2 className="text-lg font-bold text-gray-900">Reset Password</h2>
                        <p className="text-sm text-gray-500 mt-1">Enter the verification code and your new password</p>
                      </div>
                      <form onSubmit={handleResetPassword} className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Verification Code</label>
                          <input
                            type="text" required
                            value={resetCode} onChange={(e) => setResetCode(e.target.value)}
                            className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                            placeholder="Enter verification code"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                          <div className="relative">
                            <input
                              type={showResetNewPassword ? "text" : "password"} required minLength={8}
                              value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                              className="w-full px-3.5 py-2.5 pr-10 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                              placeholder="At least 8 characters"
                            />
                            <button
                              type="button"
                              onClick={() => setShowResetNewPassword(!showResetNewPassword)}
                              className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
                            >
                              {showResetNewPassword ? (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                                </svg>
                              ) : (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                              )}
                            </button>
                          </div>
                        </div>
                        <button
                          type="submit" disabled={loading}
                          className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors text-sm"
                        >
                          {loading ? "Resetting Password…" : "Reset Password"}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setError(""); setSuccess(""); setResetMode("forgot"); }}
                          className="w-full text-center text-sm text-gray-500 hover:text-gray-700 transition-colors font-medium mt-2"
                        >
                          Resend Code
                        </button>
                      </form>
                    </div>
                  )
                ) : (
                  <form onSubmit={handleRegister} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                      <input
                        type="text" required
                        value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                        placeholder="Jane Smith"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <input
                        type="email" required
                        value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                        className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                        placeholder="you@example.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                      <div className="relative">
                        <input
                          type={showRegisterPassword ? "text" : "password"} required minLength={8}
                          value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                          className="w-full px-3.5 py-2.5 pr-10 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          placeholder="Min 8 characters"
                        />
                        <button
                          type="button"
                          onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                          className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
                        >
                          {showRegisterPassword ? (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                            </svg>
                          ) : (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                      <div className="relative">
                        <input
                          type={showRegisterConfirmPassword ? "text" : "password"} required
                          value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                          className="w-full px-3.5 py-2.5 pr-10 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowRegisterConfirmPassword(!showRegisterConfirmPassword)}
                          className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
                        >
                          {showRegisterConfirmPassword ? (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                            </svg>
                          ) : (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                    <button
                      type="submit" disabled={loading}
                      className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors text-sm"
                    >
                      {loading ? "Creating account…" : "Create Account"}
                    </button>
                  </form>
                )}
              </div>
            </>
          ) : (
            <div className="p-6">
              <div className="mb-6">
                <h2 className="text-xl font-bold text-gray-900">Verify your email</h2>
                <p className="text-sm text-gray-500 mt-1">We sent a verification code to {form.email}</p>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700 animate-fade-in-down">
                  {error}
                </div>
              )}

              {success && (
                <div className="mb-4 p-3 bg-green-50 border border-green-100 rounded-lg text-sm text-green-700 animate-fade-in-down">
                  {success}
                </div>
              )}

              <form onSubmit={handleVerify} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Verification Code</label>
                  <input
                    type="text" required
                    value={code} onChange={(e) => setCode(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    placeholder="Enter code"
                  />
                </div>
                <button
                  type="submit" disabled={loading}
                  className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors text-sm"
                >
                  {loading ? "Verifying…" : "Verify"}
                </button>

                <div className="flex flex-col gap-2 text-center mt-4 pt-3 border-t border-gray-100">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleResendCode}
                    className="text-sm text-teal-600 hover:text-teal-500 font-medium transition-colors disabled:opacity-50"
                  >
                    Resend Verification Code
                  </button>
                  <button
                    type="button"
                    onClick={handleStartOver}
                    className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors"
                  >
                    Back to Sign Up
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Are you an interviewer?{" "}
          <Link href="/login" className="text-teal-600 hover:underline font-medium">
            Sign in here
          </Link>
        </p>
      </div>
    </div>
  );
}
