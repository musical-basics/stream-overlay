import Link from "next/link";

// Index for the two OBS overlay sources. Add the specific child URLs as
// Browser sources — this landing page just points to them.
export const dynamic = "force-dynamic";

export default function OverlayIndex() {
  return (
    <main className="page">
      <div className="card">
        <h1>OBS overlay URLs</h1>
        <p className="muted">
          Add the matching URL as a Browser source. Both share the same live
          announcement text and applause.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Link className="link" href="/overlay/16x9">
            → /overlay/16x9 &nbsp;(landscape, e.g. 1920×1080)
          </Link>
          <Link className="link" href="/overlay/9x16">
            → /overlay/9x16 &nbsp;(portrait, e.g. 1080×1920)
          </Link>
        </div>
      </div>
    </main>
  );
}
