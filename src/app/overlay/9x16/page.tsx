import OverlayCanvas from "@/components/OverlayCanvas";

// 9:16 (portrait) overlay — add THIS URL as a Browser source in OBS for a
// vertical canvas (e.g. 1080×1920). Background is transparent.
export const dynamic = "force-dynamic";

export default function Overlay9x16() {
  return <OverlayCanvas aspect="9:16" />;
}
