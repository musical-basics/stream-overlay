import Link from "next/link";

export default function Home() {
  return (
    <main className="page">
      <div className="card">
        <h1>Stream Overlay</h1>
        <p className="muted">Pick where you&apos;re headed.</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Link className="link" href="/overlay/16x9">
            → /overlay/16x9 &nbsp;(OBS Browser source — landscape)
          </Link>
          <Link className="link" href="/overlay/9x16">
            → /overlay/9x16 &nbsp;(OBS Browser source — portrait)
          </Link>
          <Link className="link" href="/admin">
            → /admin &nbsp;(helper control panel — requires login)
          </Link>
        </div>

        <hr className="divider" />

        <h2>For stream helpers</h2>
        <ol style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.7 }}>
          <li>
            Click{" "}
            <Link className="link" href="/admin">
              /admin
            </Link>{" "}
            above.
          </li>
          <li>Log in with the email and password I gave you.</li>
          <li>
            Try submitting the title and pressing the applause button.
          </li>
        </ol>
      </div>
    </main>
  );
}
