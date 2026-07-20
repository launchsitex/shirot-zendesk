import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface ZendeskCredentials {
  subdomain: string;
  email: string;
  api_token: string;
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function authorizeSync(
  request: Request,
  supabase: SupabaseClient,
): Promise<boolean> {
  const { data: expected, error } = await supabase.rpc("get_sync_secret");
  if (error) return false;
  return Boolean(
    expected &&
      request.headers.get("x-sync-secret") &&
      request.headers.get("x-sync-secret") === expected,
  );
}

export function getAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function getZendeskCredentials(
  supabase: SupabaseClient,
): Promise<ZendeskCredentials> {
  const { data, error } = await supabase.rpc("get_zendesk_credentials");
  if (error) throw new Error(`credentials: ${error.message}`);
  const credentials = data?.[0] as ZendeskCredentials | undefined;
  if (!credentials) throw new Error("Zendesk integration is not configured");
  return credentials;
}

function authHeader(credentials: ZendeskCredentials) {
  return `Basic ${btoa(`${credentials.email}/token:${credentials.api_token}`)}`;
}

export async function zendeskFetch<T>(
  credentials: ZendeskCredentials,
  pathOrUrl: string,
): Promise<T> {
  const expectedHost = `${credentials.subdomain}.zendesk.com`;
  const url = new URL(pathOrUrl, `https://${expectedHost}`);
  if (url.protocol !== "https:" || url.hostname !== expectedHost) {
    throw new Error("Zendesk pagination returned an untrusted URL");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: authHeader(credentials),
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      });
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < 2) {
        const retryAfter = Number(response.headers.get("Retry-After") ?? "1");
        const delaySeconds = Number.isFinite(retryAfter)
          ? Math.min(Math.max(retryAfter, 1), 10)
          : 1;
        await new Promise((resolve) =>
          setTimeout(resolve, (delaySeconds + Math.random()) * 1000),
        );
        continue;
      }
      if (!response.ok) {
        const message = (await response.text()).slice(0, 500);
        throw new Error(`Zendesk ${response.status}: ${message}`);
      }
      return response.json() as Promise<T>;
    } catch (error) {
      if (
        error instanceof Error &&
        /^Zendesk 4\d\d:/.test(error.message)
      ) {
        throw error;
      }
      if (attempt === 2) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, (2 ** attempt + Math.random()) * 1000),
      );
    }
  }

  throw new Error("Zendesk request failed");
}

export async function fetchAllPages<T>(
  credentials: ZendeskCredentials,
  path: string,
  key: string,
  maxPages = 100,
): Promise<T[]> {
  const records: T[] = [];
  let nextPage: string | null = path;
  let page = 0;

  while (nextPage && page < maxPages) {
    const result: Record<string, unknown> = await zendeskFetch(
      credentials,
      nextPage,
    );
    records.push(...((result[key] as T[] | undefined) ?? []));
    const links = result.links as { next?: string | null } | undefined;
    nextPage =
      (result.next_page as string | null | undefined) ??
      links?.next ??
      null;
    page += 1;
  }
  if (nextPage) {
    throw new Error(`Zendesk pagination exceeded ${maxPages} pages for ${key}`);
  }
  return records;
}

export function mapAgentState(agentState?: string, callStatus?: string) {
  if (callStatus === "on_call") return "on_call";
  if (callStatus === "wrap_up") return "wrap_up";
  if (callStatus === "ringing") return "ringing";
  if (agentState === "online" || agentState === "transfers_only") {
    return "available";
  }
  return "unavailable";
}
