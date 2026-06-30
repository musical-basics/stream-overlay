"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import styles from "./DoNotRequestList.module.css";

// The "do not request / overplayed" list, shown top-right when the panel mode
// is 'blocklist'. Transparent text, mirroring the chat panel's placement.
// Reads the shared do_not_request table and live-updates as helpers edit it.

type Item = { id: string; song: string; note: string };

export default function DoNotRequestList() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("do_not_request")
        .select("id, song, note, sort, created_at")
        .order("sort", { ascending: true })
        .order("created_at", { ascending: true });
      if (data) setItems(data as Item[]);
    };
    load();

    const channel = supabase
      .channel("do-not-request-overlay")
      .on(
        "postgres_changes",
        { event: "*", schema: "stream_overlay", table: "do_not_request" },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>🚫 Please don&apos;t request</div>
      <ul className={styles.list}>
        {items.map((it) => (
          <li key={it.id} className={styles.item}>
            <span className={styles.song}>{it.song}</span>
            {it.note && <span className={styles.note}>{it.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
