"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// When Supabase can't honour the `redirectTo` on an auth email — typically the
// callback isn't in the project's Redirect URLs allowlist — it falls back to
// the Site URL, i.e. this landing page, and appends the outcome to the URL.
// Success arrives as ?code=…, failure as a #error=… fragment. Without this the
// helper just lands on the landing page with no idea what happened, so pick the
// result up here and route it where it was supposed to go.
export default function AuthLinkFallback() {
  const router = useRouter();

  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const query = new URLSearchParams(search);
    const fragment = new URLSearchParams(hash.replace(/^#/, ""));

    const code = query.get("code");
    const errorCode =
      query.get("error_code") ??
      fragment.get("error_code") ??
      query.get("error") ??
      fragment.get("error");

    if (!code && !errorCode) return;

    // Drop the credentials from the address bar so a refresh can't replay them.
    window.history.replaceState(null, "", pathname);

    if (code) {
      router.replace(
        `/auth/callback?next=/reset-password&code=${encodeURIComponent(code)}`
      );
      return;
    }

    router.replace(
      `/forgot?error=${errorCode === "otp_expired" ? "invalid-link" : "link-failed"}`
    );
  }, [router]);

  return null;
}
