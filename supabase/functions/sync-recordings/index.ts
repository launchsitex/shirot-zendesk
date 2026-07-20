import {
  authorizeSync,
  fetchAllPages,
  getAdminClient,
  getZendeskCredentials,
  jsonResponse,
} from "../_shared/zendesk.ts";

type UnknownRecord = Record<string, unknown>;

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "method" }, 405);
  const supabase = getAdminClient();
  if (!(await authorizeSync(request, supabase))) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const { data: integration } = await supabase
    .from("integration_settings")
    .select("id")
    .eq("provider", "zendesk_talk")
    .eq("enabled", true)
    .maybeSingle();
  if (!integration) {
    return jsonResponse({ ok: true, skipped: "Zendesk is not configured" });
  }

  let runId: number | null = null;
  try {
    const { data: run } = await supabase
      .from("sync_runs")
      .insert({ stream: "recordings", status: "running" })
      .select("id")
      .single();
    runId = run?.id ?? null;

    const credentials = await getZendeskCredentials(supabase);
    const now = new Date();
    const cutoff = new Date(now.getTime() - 60 * 86_400_000).toISOString();
    const recheckBefore = new Date(
      now.getTime() - 24 * 60 * 60_000,
    ).toISOString();
    const { data: calls, error: callsError } = await supabase
      .from("calls")
      .select("id,raw,started_at,duration_seconds,recordings_checked_at")
      .gte("started_at", cutoff)
      .or(
        `recordings_checked_at.is.null,recordings_checked_at.lt.${recheckBefore}`,
      )
      .order("recordings_checked_at", { ascending: true, nullsFirst: true })
      .limit(40);
    if (callsError) throw callsError;

    const candidates = (calls ?? [])
      .filter(
        (call) =>
          Boolean((call.raw as UnknownRecord | null)?.ticket_id),
      )
      .slice(0, 40);

    const rows: UnknownRecord[] = [];
    for (const call of candidates) {
      const raw = (call.raw ?? {}) as UnknownRecord;
      const ticketId = String(raw.ticket_id);
      const comments = await fetchAllPages<UnknownRecord>(
        credentials,
        `/api/v2/tickets/${ticketId}/comments.json?page[size]=100`,
        "comments",
        20,
      );
      for (const comment of comments) {
        const data = (comment.data ?? {}) as UnknownRecord;
        if (String(data.call_id ?? "") !== String(call.id)) continue;
        const recordingUrl = String(
          data.recording_url ?? comment.recording_url ?? "",
        );
        if (!isSecureUrl(recordingUrl)) continue;
        const recordingType = String(data.recording_type ?? "call");
        rows.push({
          id: `${call.id}-${comment.id}-${recordingType}`,
          call_id: call.id,
          ticket_id: ticketId,
          comment_id: String(comment.id),
          recording_type: recordingType,
          recording_url: recordingUrl,
          duration_seconds: Number(
            data.call_duration ?? call.duration_seconds ?? 0,
          ),
          created_at: String(comment.created_at ?? call.started_at),
          raw: comment,
          synced_at: new Date().toISOString(),
        });
      }
      const { error: checkedError } = await supabase
        .from("calls")
        .update({ recordings_checked_at: new Date().toISOString() })
        .eq("id", call.id);
      if (checkedError) throw checkedError;
    }

    if (rows.length) {
      const { error } = await supabase.from("call_recordings").upsert(rows, {
        onConflict: "id",
      });
      if (error) throw error;
    }

    if (runId) {
      await supabase
        .from("sync_runs")
        .update({
          status: "success",
          records_processed: rows.length,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }
    return jsonResponse({
      ok: true,
      recordings: rows.length,
      callsChecked: candidates.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) {
      await supabase
        .from("sync_runs")
        .update({
          status: "failed",
          error_message: message.slice(0, 1000),
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }
    return jsonResponse({ error: message }, 500);
  }
});

function isSecureUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
