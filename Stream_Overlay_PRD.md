# Product Requirements Document (PRD): Real-Time Stream Overlay & Logging System

## 1. Overview
**Product Name:** StreamSync Overlay
**Description:** A real-time stream overlay system designed for OBS that allows authenticated helpers to push text updates and sound/visual effects to a live stream. It simultaneously logs these events with UTC timestamps and calculates relative VOD timestamps for easy post-production editing and YouTube chapter generation.
**Tech Stack:** Next.js (Frontend), Vercel (Hosting), Supabase (Database, Auth, WebSockets).

## 2. Problem Statement
Streamers often need to update on-screen information (like the current song or segment) and trigger visual/audio effects without breaking their flow. Giving access to OBS directly to helpers is complex and resource-intensive. Furthermore, aligning stream events with post-stream video recordings for chapter generation is a highly manual, time-consuming process.

## 3. Target Audience (Personas)
1. **The Streamer (Host):** Needs an unobtrusive OBS overlay that instantly reacts to updates and a post-stream export of chapter timestamps.
2. **The Stream Helpers:** Trusted individuals who log into a web dashboard to submit text updates, view their own personal history of submissions, and trigger transient effects (applause) on the stream.

## 4. Features & Requirements

### 4.1. Authentication & Security
* **Requirement:** Only authorized users can push to the overlay.
* **Details:** * Implementation via Supabase Email/Password Auth.
    * Row Level Security (RLS) policies on the database ensure helpers can only fetch their own historical submissions.

### 4.2. Helper Control Panel (`/admin`)
* **Submit Text:** A text input and "Submit to Stream" button. This overrides the current overlay text by inserting a new row into the database.
* **Personal History:** A list displaying the logged-in helper's previously submitted texts.
* **Quick Re-submit:** A button next to each historical item allowing the helper to push it live again (creating a *new* database row and timestamp).
* **Applause Trigger:** A button that sends a stateless Broadcast message to the overlay to trigger sound/emojis.
* **Mark Stream Start:** A dedicated button to log the exact time the stream/recording begins (creates a `stream_start` event row).

### 4.3. OBS Overlay (`/overlay`)
* **UI/UX:** Transparent background, designed specifically to be added as a Browser Source in OBS.
* **Stateful Text Updates:** On mount, fetches the latest `text_update` event. Subscribes to Supabase Postgres `INSERT` events to update the text state with sub-second latency whenever a new row is added.
* **Stateless Effects:** Subscribes to Supabase Broadcast channel. Upon receiving an `applause` event, plays an HTML5 `<audio>` element and triggers a CSS animation for floating emojis.

### 4.4. Timestamp Export System (`/admin/export`)
* **Requirement:** Calculate relative timestamps for YouTube chapters or video editing.
* **Logic:** * Fetches the latest `stream_start` timestamp ($T_{start}$).
    * Fetches all subsequent `text_update` timestamps ($T_{event}$).
    * Calculates relative time ($T_{relative} = T_{event} - T_{start}$).
* **Output Format:** Clean text block formatting (e.g., `00:00 Stream Start`, `05:12 Now playing: Fur Elise`) ready to copy-paste.

## 5. Database Schema

**Table:** `stream_events`
* `id`: UUID (Primary Key, default: `uuid_generate_v4()`)
* `created_at`: Timestamptz (default: `now()`)
* `event_type`: String (e.g., `'stream_start'`, `'text_update'`)
* `content`: String (The actual text shown on screen. Nullable for `stream_start`)
* `helper_id`: UUID (Foreign Key to Supabase Auth Users table)

## 6. Real-Time Architecture
* **Persistent Data (Text Updates):** Uses **Supabase Postgres Changes**. Inserts to the `stream_events` table are pushed to the OBS client.
* **Ephemeral Data (Applause):** Uses **Supabase Broadcast**. A message is pushed to a shared channel (e.g., `overlay-effects`), bypassing the database entirely for lowest latency.

## 7. Out of Scope (V1)
* Overlay theme customization (colors/fonts) via the control panel (hardcoded in CSS for V1).
* Streamer dashboard to manage helper accounts (manual setup via Supabase dashboard for V1).
* Twitch/YouTube chat integrations.
