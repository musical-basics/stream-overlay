"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import ChatEmbed from "./ChatEmbed";
import DoNotRequestList from "./DoNotRequestList";

// Owns the chat_settings singleton and decides what the top-right overlay panel
// shows: the live chat, the do-not-request list, or nothing. Live-updates when
// an admin flips the mode or changes the video id.
export default function TopRightPanel() {
  const [mode, setMode] = useState("chat");
  const [videoId, setVideoId] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("chat_settings")
        .select("video_id, panel_mode")
        .eq("id", 1)
        .maybeSingle();
      setMode((data?.panel_mode ?? "chat").trim() || "chat");
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

  if (mode === "blocklist") return <DoNotRequestList />;
  if (mode === "chat") return <ChatEmbed videoId={videoId} />;
  return null; // 'off'
}
