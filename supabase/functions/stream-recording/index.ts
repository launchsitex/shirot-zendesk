import {
  getAdminClient,
  jsonResponse,
} from "../_shared/zendesk.ts";
import { fetchRecordingAudio } from "../_shared/recordings.ts";

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
    .select("id,call_id,recording_url,recording_type,raw")
    .eq("id", recordingId)
    .single();
  if (error || !recording) {
    return jsonResponse({ error: "recording_not_found" }, 404);
  }

  try {
    const response = await fetchRecordingAudio(supabase, recording, {
      range: request.headers.get("range"),
    });

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("403")
      ? 403
      : message.includes("404")
        ? 404
        : 502;
    return jsonResponse({ error: message }, status);
  }
});
