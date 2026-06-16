"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ControlPanel() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [status, setStatus] = useState<{ msg: string; ok: boolean }>({
    msg: "",
    ok: true,
  });
  const [applauseBusy, setApplauseBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the current overlay text (public read via anon key).
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("overlay_state")
      .select("now_playing")
      .eq("id", 1)
      .single()
      .then(({ data }) => {
        if (!cancelled && data) {
          setText(data.now_playing ?? "");
          setSavedText(data.now_playing ?? "");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveText(value: string) {
    const res = await fetch("/api/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: value }),
    });
    if (res.status === 401) {
      router.push("/login?next=/control");
      return;
    }
    if (res.ok) {
      setSavedText(value);
      setStatus({ msg: "Overlay updated ✓", ok: true });
    } else {
      setStatus({ msg: "Failed to update", ok: false });
    }
  }

  // Debounced live-save as the helper types.
  function onChangeText(value: string) {
    setText(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveText(value), 500);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveText(text);
  }

  function clearText() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setText("");
    saveText("");
  }

  async function fireApplause() {
    setApplauseBusy(true);
    const res = await fetch("/api/applause", { method: "POST" });
    if (res.status === 401) {
      router.push("/login?next=/control");
      return;
    }
    setStatus(
      res.ok
        ? { msg: "Applause sent 👏", ok: true }
        : { msg: "Applause failed", ok: false }
    );
    // Brief cooldown to avoid accidental double-fires.
    setTimeout(() => setApplauseBusy(false), 1200);
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
  }

  const dirty = text !== savedText;

  return (
    <main className="page">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1>Control panel</h1>
          <button className="btn-ghost" onClick={logout}>
            Log out
          </button>
        </div>
        <p className="muted">Changes appear on the overlay instantly.</p>

        <form onSubmit={onSubmit}>
          <label htmlFor="np">Now playing text</label>
          <textarea
            id="np"
            rows={3}
            value={text}
            placeholder="e.g. Now playing: Für Elise"
            onChange={(e) => onChangeText(e.target.value)}
          />

          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn-primary" type="submit">
              {dirty ? "Save now" : "Saved"}
            </button>
            <button className="btn-ghost" type="button" onClick={clearText}>
              Clear text
            </button>
          </div>
        </form>

        <hr
          style={{
            border: "none",
            borderTop: "1px solid #262b36",
            margin: "24px 0",
          }}
        />

        <label>Effects</label>
        <button
          className="btn-applause"
          style={{ width: "100%" }}
          onClick={fireApplause}
          disabled={applauseBusy}
        >
          {applauseBusy ? "👏 …" : "👏 Trigger applause"}
        </button>

        <div className={`status ${status.ok ? "ok" : "err"}`}>{status.msg}</div>
      </div>
    </main>
  );
}
