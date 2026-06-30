import { NextRequest, NextResponse } from "next/server";

// Server-side proxy to the YouTube Data API so we can render the live chat as
// our own (transparent, restylable) text instead of YouTube's iframe widget.
// The API key stays on the server; the overlay just polls this route.
//
// Flow:
//   1. Resolve the video's activeLiveChatId (only when the client doesn't
//      already have one — saves a quota unit per poll).
//   2. List new messages for that chat, passing back YouTube's own polling
//      interval and page token so the client polls at the recommended rate
//      and only ever fetches messages it hasn't seen.

export const dynamic = "force-dynamic";

const API = "https://www.googleapis.com/youtube/v3";

type VideosResp = {
  items?: { liveStreamingDetails?: { activeLiveChatId?: string } }[];
  error?: { message?: string };
};

type MessageItem = {
  id?: string;
  snippet?: { displayMessage?: string };
  authorDetails?: { displayName?: string };
};

type MessagesResp = {
  items?: MessageItem[];
  nextPageToken?: string;
  pollingIntervalMillis?: number;
  error?: { message?: string };
};

export async function GET(req: NextRequest) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "missing_api_key" }, { status: 500 });
  }

  const sp = req.nextUrl.searchParams;
  const video = sp.get("video")?.trim() ?? "";
  let chatId = sp.get("chatId")?.trim() ?? "";
  const page = sp.get("page")?.trim() ?? "";

  if (!video && !chatId) {
    return NextResponse.json({ error: "missing_video" }, { status: 400 });
  }

  try {
    // 1. Resolve the active live-chat id from the video, if needed.
    if (!chatId) {
      const r = await fetch(
        `${API}/videos?part=liveStreamingDetails&id=${encodeURIComponent(video)}&key=${key}`,
        { cache: "no-store" }
      );
      const j = (await r.json()) as VideosResp;
      if (!r.ok) {
        return NextResponse.json(
          { error: "youtube_error", detail: j.error?.message },
          { status: 502 }
        );
      }
      chatId = j.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? "";
      // No active chat → not live (or chat disabled). Poll slowly until it is.
      if (!chatId) return NextResponse.json({ live: false, pollingMs: 15000 });
    }

    // 2. List messages for the chat.
    const url =
      `${API}/liveChat/messages?liveChatId=${encodeURIComponent(chatId)}` +
      `&part=snippet,authorDetails&maxResults=200&key=${key}` +
      (page ? `&pageToken=${encodeURIComponent(page)}` : "");
    const r = await fetch(url, { cache: "no-store" });
    const j = (await r.json()) as MessagesResp;
    if (!r.ok) {
      // Chat ended or the id went stale — tell the client to re-resolve.
      return NextResponse.json({
        live: false,
        pollingMs: 15000,
        detail: j.error?.message,
      });
    }

    const messages = (j.items ?? [])
      .map((it) => ({
        id: it.id ?? "",
        author: it.authorDetails?.displayName ?? "",
        message: it.snippet?.displayMessage ?? "",
      }))
      .filter((m) => m.id && m.message);

    return NextResponse.json({
      live: true,
      chatId,
      messages,
      nextPage: j.nextPageToken ?? "",
      pollingMs: Math.max(2000, Number(j.pollingIntervalMillis) || 5000),
    });
  } catch {
    return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
  }
}
