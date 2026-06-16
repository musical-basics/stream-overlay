applause.mp3 — the sound the overlay plays on "Applause".

Ships as a real ~5s crowd-applause sample: trimmed to start instantly on
the applause onset, faded out over the last ~1.2s, and normalized to a
gentle ~-20 LUFS (peak ~-6 dBTP) so it's never too loud. To use your own,
just replace applause.mp3 with any mp3 of the same name.

A synthesized fallback can be regenerated with scripts/gen-applause.mjs.
If the file is ever missing, the overlay also falls back to a Web-Audio
synthesized applause at runtime so the button always works.
