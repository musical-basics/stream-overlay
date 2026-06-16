"use client";

import { useState } from "react";

export default function ExportView({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can still select the text manually */
    }
  }

  const rows = Math.min(24, Math.max(6, text.split("\n").length + 1));

  return (
    <div>
      <textarea
        readOnly
        rows={rows}
        value={text}
        style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 14 }}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div style={{ marginTop: 12 }}>
        <button className="btn-primary" onClick={copy}>
          {copied ? "Copied ✓" : "Copy to clipboard"}
        </button>
      </div>
    </div>
  );
}
