// Pull an 11-char YouTube video id out of whatever an admin pastes — a full
// watch URL, a youtu.be link, a /live/ link, or the bare id itself.
export function parseYouTubeId(input: string): string {
  const s = input.trim();
  if (!s) return "";
  const m =
    s.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
    s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
    s.match(/\/live\/([A-Za-z0-9_-]{11})/) ||
    s.match(/\/embed\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s; // already a bare id
  return s; // unknown shape — store as-is so nothing is silently dropped
}
