"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

// Why the callback hop: the browser client uses the PKCE flow, so the emailed
// link carries a one-time code that has to be swapped for a session before a
// new password can be set. /auth/callback does that swap, then forwards to
// /reset-password.
const CALLBACK = "/auth/callback?next=/reset-password";

const LINK_ERRORS: Record<string, string> = {
  "missing-code": "That link was missing its code. Request a fresh one below.",
  "invalid-link":
    "That link has expired or was already used. Request a fresh one below.",
};

function ForgotForm() {
  const params = useSearchParams();
  const linkError = LINK_ERRORS[params.get("error") ?? ""] ?? "";

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}${CALLBACK}`,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <main className="page">
        <div className="card">
          <h1>Check your email</h1>
          <p className="muted">
            If an account exists for <strong>{email.trim()}</strong>, a reset
            link is on its way. It expires in an hour, and it has to be opened
            in this same browser.
          </p>
          <Link className="link" href="/login">
            ← Back to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <form className="card" onSubmit={submit}>
        <h1>Reset your password</h1>
        <p className="muted">
          Enter your helper email and we&rsquo;ll send you a link to set a new
          password.
        </p>

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          autoFocus
          required
          onChange={(e) => setEmail(e.target.value)}
        />

        <div className="row" style={{ marginTop: 20 }}>
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
          <Link className="link" href="/login" style={{ fontSize: 13 }}>
            Back to login
          </Link>
        </div>

        <div className={`status ${error || linkError ? "err" : ""}`}>
          {error || linkError}
        </div>
      </form>
    </main>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotForm />
    </Suspense>
  );
}
