"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/control";

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push(next);
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Login failed");
    }
  }

  return (
    <main className="page">
      <form className="card" onSubmit={submit}>
        <h1>Control panel login</h1>
        <p className="muted">Enter the shared password.</p>

        <label htmlFor="pw">Password</label>
        <input
          id="pw"
          type="password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
        />

        <div style={{ marginTop: 20 }}>
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? "Checking…" : "Log in"}
          </button>
        </div>

        <div className={`status ${error ? "err" : ""}`}>{error}</div>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
