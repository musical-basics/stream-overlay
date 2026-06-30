"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import styles from "./NowPlaying.module.css";

// Persistent "now playing" chip, top-left under the request ticker. Unlike the
// announcement, this never fades — it shows whatever admins last set, and stays
// until changed. Reads the singleton `now_playing` row and live-updates.
export default function NowPlaying() {
  const [song, setSong] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("now_playing")
        .select("song")
        .eq("id", 1)
        .maybeSingle();
      setSong((data?.song ?? "").trim());
    };
    load();

    const channel = supabase
      .channel("now-playing")
      .on(
        "postgres_changes",
        { event: "*", schema: "stream_overlay", table: "now_playing" },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (!song) return null; // nothing set — hide the chip entirely

  return (
    <div className={styles.nowPlaying}>
      <div className={styles.label}>♪ Now Playing</div>
      <div className={styles.song}>{song}</div>
    </div>
  );
}
