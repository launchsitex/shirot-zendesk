import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type RecordingRow = {
  id: string;
  call_id: string;
  recording_url: string;
  recording_type?: string | null;
  raw: unknown;
};

export async function fetchRecordingAudio(
  supabase: SupabaseClient,
  recording: RecordingRow,
  options: { range?: string | null } = {},
): Promise<Response> {
  let url = recording.recording_url;
  const provider = (recording.raw as { provider?: string } | null)?.provider;
  const isAircall = provider === "aircall";

  let response = await downloadMedia(supabase, url, provider, options.range);
  if (
    isAircall &&
    (response.status === 403 ||
      response.status === 401 ||
      response.status === 404)
  ) {
    url = await refreshAircallMediaUrl(
      supabase,
      recording.call_id,
      recording.recording_type ?? "call",
    );
    await supabase
      .from("call_recordings")
      .update({
        recording_url: url,
        synced_at: new Date().toISOString(),
      })
      .eq("id", recording.id);
    response = await downloadMedia(supabase, url, "aircall", options.range);
  }

  if (!response.ok && response.status !== 206) {
    throw new Error(`recording_fetch_failed:${response.status}`);
  }
  return response;
}

async function downloadMedia(
  supabase: SupabaseClient,
  recordingUrlRaw: string,
  provider: string | undefined,
  range?: string | null,
) {
  const recordingUrl = new URL(recordingUrlRaw);
  if (recordingUrl.protocol !== "https:") {
    throw new Error("untrusted_recording_host");
  }

  const headers: HeadersInit = { Accept: "audio/mpeg,audio/wav,audio/*" };
  if (provider !== "aircall") {
    const { data: credentials } = await supabase.rpc("get_zendesk_credentials");
    if (!credentials?.[0]) throw new Error("recording_credentials_missing");
    const { subdomain, email, api_token: apiToken } = credentials[0];
    if (recordingUrl.hostname !== `${subdomain}.zendesk.com`) {
      throw new Error("untrusted_recording_host");
    }
    headers.Authorization = `Basic ${btoa(`${email}/token:${apiToken}`)}`;
  }
  if (range) headers.Range = range;

  let response = await fetch(recordingUrl, { headers, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error("recording_redirect_failed");
    const redirectedUrl = new URL(location, recordingUrl);
    if (redirectedUrl.protocol !== "https:") {
      throw new Error("untrusted_recording_redirect");
    }
    const redirectedHeaders: HeadersInit = {
      Accept: "audio/mpeg,audio/wav,audio/*",
    };
    if (range) redirectedHeaders.Range = range;
    response = await fetch(redirectedUrl, {
      headers: redirectedHeaders,
      redirect: "follow",
    });
  }
  return response;
}

export async function refreshAircallMediaUrl(
  supabase: SupabaseClient,
  callId: string,
  recordingType: string,
): Promise<string> {
  const { data: credentials, error } = await supabase
    .rpc("get_aircall_api_credentials")
    .maybeSingle();
  if (error || !credentials?.api_id || !credentials?.api_token) {
    throw new Error("aircall_api_credentials_missing");
  }

  const auth = btoa(`${credentials.api_id}:${credentials.api_token}`);
  const response = await fetch(`https://api.aircall.io/v1/calls/${callId}`, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`aircall_call_fetch_failed:${response.status}`);
  }

  const payload = (await response.json()) as {
    call?: Record<string, unknown>;
  };
  const call = payload.call ?? {};
  const isVoicemail = recordingType === "voicemail";
  const url = String(
    (isVoicemail
      ? call.voicemail ?? call.voicemail_short_url
      : call.recording ?? call.recording_short_url) ?? "",
  );
  if (!url.startsWith("https://")) {
    throw new Error("aircall_recording_missing");
  }
  return url;
}

export async function fetchRecordingBytes(
  supabase: SupabaseClient,
  recording: RecordingRow,
) {
  const response = await fetchRecordingAudio(supabase, recording);
  const contentType =
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "audio/mpeg";
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error("recording_empty");
  return { bytes, mimeType: normalizeAudioMime(contentType) };
}

function normalizeAudioMime(contentType: string) {
  const lower = contentType.toLowerCase();
  if (lower.includes("wav")) return "audio/wav";
  if (lower.includes("ogg")) return "audio/ogg";
  if (lower.includes("flac")) return "audio/flac";
  if (lower.includes("aac")) return "audio/aac";
  if (lower.includes("mp4") || lower.includes("m4a")) return "audio/mp4";
  return "audio/mp3";
}
