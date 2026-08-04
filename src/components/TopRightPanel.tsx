"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import ChatEmbed from "./ChatEmbed";
import DoNotRequestList from "./DoNotRequestList";
import styles from "./TopRightPanel.module.css";

// Owns the chat_settings singleton and decides what the top-right overlay panel
// shows: the live chat, the do-not-request list, or nothing. Live-updates when
// an admin flips the mode, changes the video id, or drags the panel to a new
// spot in the admin preview. Realtime is the fast path; a slow poll backs it up
// so the overlay always converges on the DB state even if the Realtime
// subscription drops or the table isn't in the publication.
type PanelPos = { x: number; y: number };

export default function TopRightPanel() {
  const [mode, setMode] = useState("chat");
  const [videoId, setVideoId] = useState("");
  const [pos, setPos] = useState<PanelPos | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // select("*") so deployments whose DB predates panel_x/panel_y still work.
      const { data } = await supabase
        .from("chat_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (cancelled || !data) return;
      setMode(((data.panel_mode as string) ?? "chat").trim() || "chat");
      setVideoId(((data.video_id as string) ?? "").trim());
      const x = Number(data.panel_x);
      const y = Number(data.panel_y);
      setPos(
        data.panel_x != null && data.panel_y != null && isFinite(x) && isFinite(y)
          ? { x, y }
          : null
      );
    };
    load();

    const poll = setInterval(load, 15_000);
    const channel = supabase
      .channel("chat-settings")
      .on(
        "postgres_changes",
        { event: "*", schema: "stream_overlay", table: "chat_settings" },
        () => load()
      )
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, []);

  const body =
    mode === "blocklist" ? (
      <DoNotRequestList />
    ) : mode === "chat" ? (
      <ChatEmbed videoId={videoId} />
    ) : null; // 'off'
  if (!body) return null;

  // Custom position: left/top is the panel's top-RIGHT corner (in % of the
  // overlay), so translateX(-100%) keeps the box right-anchored to that point.
  const style = pos
    ? {
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        right: "auto",
        transform: "translateX(-100%)",
      }
    : undefined;

  return (
    <div className={styles.wrap} style={style}>
      {body}
    </div>
  );
}
