import {
  getAdminClient,
  jsonResponse,
} from "../_shared/zendesk.ts";

Deno.serve(async (request) => {
  if (request.method !== "GET") return jsonResponse({ error: "method" }, 405);

  const authorization = request.headers.get("authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return jsonResponse({ error: "unauthorized" }, 401);

  const supabase = getAdminClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) return jsonResponse({ error: "unauthorized" }, 401);

  const recordingId = new URL(request.url).searchParams.get("id");
  if (!recordingId) return jsonResponse({ error: "recording_id_required" }, 400);

  const { data: recording, error } = await supabase
    .from("call_recordings")
    .select("recording_url,raw")
    .eq("id", recordingId)
    .single();
  if (error || !recording) {
    return jsonResponse({ error: "recording_not_found" }, 404);
  }

  const recordingUrl = new URL(recording.recording_url);
  if (recordingUrl.protocol !== "https:") {
    return jsonResponse({ error: "untrusted_recording_host" }, 403);
  }

  const provider = (recording.raw as { provider?: string } | null)?.provider;
  const headers: HeadersInit = { Accept: "audio/mpeg,audio/wav,audio/*" };
  if (provider !== "aircall") {
    const { data: credentials } = await supabase.rpc("get_zendesk_credentials");
    if (!credentials?.[0]) {
      return jsonResponse({ error: "recording_credentials_missing" }, 404);
    }
    const { subdomain, email, api_token: apiToken } = credentials[0];
    if (recordingUrl.hostname !== `${subdomain}.zendesk.com`) {
      return jsonResponse({ error: "untrusted_recording_host" }, 403);
    }
    headers.Authorization = `Basic ${btoa(`${email}/token:${apiToken}`)}`;
  }
  const range = request.headers.get("range");
  if (range) headers.Range = range;

  let response = await fetch(recordingUrl, {
    headers,
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) return jsonResponse({ error: "recording_redirect_failed" }, 502);
    const redirectedUrl = new URL(location, recordingUrl);
    if (redirectedUrl.protocol !== "https:") {
      return jsonResponse({ error: "untrusted_recording_redirect" }, 403);
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

  if (!response.ok && response.status !== 206) {
    return jsonResponse({ error: "recording_fetch_failed" }, response.status);
  }

  const responseHeaders = new Headers();
  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
  ]) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("Cache-Control", "private, no-store");

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
});
