"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";

const MIN_LENGTH = 8;

export default function ResetPasswordPage() {
  const router = useRouter();

  // null while we're still checking for the recovery session.
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // /auth/callback already traded the emailed code for a session cookie, so
  // this page only has to confirm one landed before showing the form.
  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setHasSession(Boolean(data.session)));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }

    setBusy(true);
    setError("");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }

    // The recovery session is a real session, so they're already signed in.
    router.push("/admin");
    router.refresh();
  }

  if (hasSession === null) {
    return (
      <main className="page">
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Checking your reset link…
          </p>
        </div>
      </main>
    );
  }

  if (!hasSession) {
    return (
      <main className="page">
        <div className="card">
          <h1>This link isn&rsquo;t valid</h1>
          <p className="muted">
            Reset links expire after an hour, can only be used once, and have to
            be opened in the browser that requested them.
          </p>
          <Link className="link" href="/forgot">
            Request a new link →
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <form className="card" onSubmit={submit}>
        <h1>Choose a new password</h1>
        <p className="muted">
          At least {MIN_LENGTH} characters. You&rsquo;ll be signed in straight
          afterwards.
        </p>

        <label htmlFor="pw">New password</label>
        <input
          id="pw"
          type="password"
          autoComplete="new-password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
          style={{ marginBottom: 16 }}
        />

        <label htmlFor="pw2">Confirm new password</label>
        <input
          id="pw2"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />

        <div style={{ marginTop: 20 }}>
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save password"}
          </button>
        </div>

        <div className={`status ${error ? "err" : ""}`}>{error}</div>
      </form>
    </main>
  );
}
