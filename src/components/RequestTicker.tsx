"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import styles from "./RequestTicker.module.css";

type Req = { id: string; song: string; requester: string };

const ORD = ["1st", "2nd", "3rd", "4th", "5th"];
const ordinal = (n: number) => ORD[n - 1] ?? `${n}th`;

// News-style scrolling ticker across the top with the current request queue.
// Reads the shared `requests` table and live-updates as helpers edit it.
export default function RequestTicker() {
  const [reqs, setReqs] = useState<Req[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("requests")
        .select("id, song, requester, sort, created_at")
        .order("sort", { ascending: true })
        .order("created_at", { ascending: true });
      if (data) setReqs(data as Req[]);
    };
    load();

    const channel = supabase
      .channel("requests-ticker")
      .on(
        "postgres_changes",
        { event: "*", schema: "stream_overlay", table: "requests" },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (reqs.length === 0) return null;

  const text = reqs
    .map(
      (r, i) =>
        `${ordinal(i + 1)} request: ${r.song}${r.requester ? ` by ${r.requester}` : ""}`
    )
    .join(" • ");

  // Pace the scroll by content length so long queues aren't too fast.
  const duration = Math.max(16, text.length * 0.32);

  return (
    <div className={styles.ticker}>
      <div className={styles.label}>🎵 Requests</div>
      <div className={styles.viewport}>
        <div className={styles.track} style={{ animationDuration: `${duration}s` }}>
          <span className={styles.group}>{text}</span>
          <span className={styles.group} aria-hidden>
            {text}
          </span>
        </div>
      </div>
    </div>
  );
}
