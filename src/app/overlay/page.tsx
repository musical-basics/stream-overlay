import OverlayCanvas from "@/components/OverlayCanvas";

// Public page — no auth. Add this URL as a Browser source in OBS.
// The page background is transparent (see globals.css) so only the lower-third
// text and floating emojis are visible over your stream.
export const dynamic = "force-dynamic";

export default function OverlayPage() {
  return <OverlayCanvas />;
}
