import OverlayCanvas from "@/components/OverlayCanvas";

// 16:9 (landscape) overlay — add THIS URL as a Browser source in OBS for a
// horizontal canvas (e.g. 1920×1080). Background is transparent.
export const dynamic = "force-dynamic";

export default function Overlay16x9() {
  return <OverlayCanvas aspect="16:9" />;
}
