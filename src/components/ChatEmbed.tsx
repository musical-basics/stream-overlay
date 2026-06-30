"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import styles from "./ChatEmbed.module.css";

// Live YouTube chat rendered as our own text on a transparent background
// (top-right, under the request ticker). The video id is admin-set per stream
// in chat_settings; we poll /api/chat (which talks to the YouTube Data API
// server-side) for new messages. Hidden until there are messages to show.

type Msg = { id: string; author: string; message: string };

type ChatResponse = {
  live?: boolean;
  chatId?: string;
  nextPage?: string;
  pollingMs?: number;
  messages?: Msg[];
};

const MAX_MESSAGES = 20; // keep the newest N on screen

export default function ChatEmbed() {
  const [videoId, setVideoId] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);

  // Track the current video id (admin-set) and live-update on change.
  useEffect(() => {
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

  // Poll the server route for new messages while a video id is set.
  useEffect(() => {
    setMessages([]);
    if (!videoId) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let chatId = "";
    let page = "";
    const seen = new Set<string>();

    const tick = async () => {
      if (stopped) return;
      let pollingMs = 6000;
      try {
        const qs = new URLSearchParams({ video: videoId });
        if (chatId) qs.set("chatId", chatId);
        if (page) qs.set("page", page);

        const res = await fetch(`/api/chat?${qs.toString()}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as ChatResponse;

        if (data.live) {
          chatId = data.chatId || chatId;
          page = data.nextPage || "";
          pollingMs = data.pollingMs || pollingMs;

          const fresh = (data.messages ?? []).filter((m) => !seen.has(m.id));
          if (fresh.length) {
            fresh.forEach((m) => seen.add(m.id));
            // Keep the seen-set from growing without bound on long streams.
            if (seen.size > 1000) {
              seen.clear();
              fresh.forEach((m) => seen.add(m.id));
            }
            setMessages((prev) => [...prev, ...fresh].slice(-MAX_MESSAGES));
          }
        } else {
          // Not live yet / chat ended — drop the id so we re-resolve, slow down.
          chatId = "";
          page = "";
          pollingMs = data.pollingMs || 15000;
        }
      } catch {
        pollingMs = 10000; // network/route error — back off and retry
      }
      if (!stopped) timer = setTimeout(tick, pollingMs);
    };

    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [videoId]);

  if (!videoId || messages.length === 0) return null;

  return (
    <div className={styles.chat}>
      {messages.map((m) => (
        <div key={m.id} className={styles.line}>
          <span className={styles.author}>{m.author}</span>
          <span className={styles.text}>{m.message}</span>
        </div>
      ))}
    </div>
  );
}
