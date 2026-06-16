import Link from "next/link";

export default function Home() {
  return (
    <main className="page">
      <div className="card">
        <h1>Stream Overlay</h1>
        <p className="muted">Pick where you&apos;re headed.</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Link className="link" href="/overlay">
            → /overlay &nbsp;(add this URL as a Browser source in OBS)
          </Link>
          <Link className="link" href="/control">
            → /control &nbsp;(helper control panel — requires login)
          </Link>
        </div>
      </div>
    </main>
  );
}
