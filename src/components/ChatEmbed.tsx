"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import styles from "./ChatEmbed.module.css";

// YouTube live-chat panel, top-right under the request ticker. Reads the
// singleton chat_settings row (an admin sets the live video id each stream)
// and live-updates. Hidden until a video id is set.
//
// YouTube requires the embedding page's host in `embed_domain`; we read it
// from the live overlay URL so it works on whatever domain OBS loads.
export default function ChatEmbed() {
  const [videoId, setVideoId] = useState("");
  const [host, setHost] = useState("");

  useEffect(() => {
    setHost(window.location.hostname);

    const load = async () => {
      const { data } = await supabase
        .from("chat_settings")
        .select("video_id")
        .eq("id", 1)
        .maybeSingle();
      setVideoId((data?.video_id ?? "").trim());
    };
    load();

    const channel = supabase
      .channel("chat-settings")
      .on(
        "postgres_changes",
        { event: "*", schema: "stream_overlay", table: "chat_settings" },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (!videoId || !host) return null;

  const src =
    `https://www.youtube.com/live_chat?v=${encodeURIComponent(videoId)}` +
    `&embed_domain=${encodeURIComponent(host)}&dark_theme=1`;

  return (
    <div className={styles.chat}>
      <iframe title="Live chat" src={src} />
    </div>
  );
}
