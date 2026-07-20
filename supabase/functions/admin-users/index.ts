import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ALL_PAGES = [
  "dashboard",
  "wallboard",
  "calls",
  "recordings",
  "agents",
  "analytics",
  "settings",
  "users",
] as const;

type AppRole = "admin" | "manager" | "viewer";
type PageKey = (typeof ALL_PAGES)[number];

type ProfileRow = {
  id: string;
  display_name: string | null;
  role: AppRole;
  department_id: string | null;
  allowed_pages: string[] | null;
  created_at: string;
  updated_at: string;
  departments?: { id: string; name: string } | null;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "unauthorized" }, 401);
    }

    const admin = getAdminClient();
    const caller = await getCaller(admin, authHeader);
    if (!caller) return json({ error: "unauthorized" }, 401);
    if (!(await isAdmin(admin, caller.id))) {
      return json({ error: "admin role required" }, 403);
    }

    const url = new URL(request.url);
    const userId = url.searchParams.get("id");

    if (request.method === "GET") {
      return json(await listUsers(admin));
    }

    if (request.method === "POST") {
      const body = await request.json();
      return json(await createUser(admin, body, caller.id));
    }

    if (request.method === "PATCH") {
      if (!userId) return json({ error: "missing user id" }, 400);
      const body = await request.json();
      return json(await updateUser(admin, userId, body, caller.id));
    }

    if (request.method === "DELETE") {
      if (!userId) return json({ error: "missing user id" }, 400);
      return json(await deleteUser(admin, userId, caller.id));
    }

    return json({ error: "method not allowed" }, 405);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
});

function getAdminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function getCaller(
  admin: ReturnType<typeof createClient>,
  authHeader: string,
) {
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return null;
  return data.user;
}

async function isAdmin(
  admin: ReturnType<typeof createClient>,
  userId: string,
) {
  const { data } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  return data?.role === "admin";
}

async function listUsers(admin: ReturnType<typeof createClient>) {
  const [{ data: profiles, error: profilesError }, authUsers] =
    await Promise.all([
      admin
        .from("profiles")
        .select(
          "id, display_name, role, department_id, allowed_pages, created_at, updated_at, departments(id, name)",
        )
        .order("created_at", { ascending: true }),
      listAllAuthUsers(admin),
    ]);

  if (profilesError) throw new Error(profilesError.message);

  const emailById = new Map(
    authUsers.map((user) => [user.id, user.email ?? ""]),
  );

  const users = ((profiles ?? []) as ProfileRow[]).map((profile) => ({
    id: profile.id,
    email: emailById.get(profile.id) ?? "",
    displayName: profile.display_name,
    role: profile.role,
    departmentId: profile.department_id,
    departmentName: profile.departments?.name ?? null,
    allowedPages: normalizePages(profile.allowed_pages, profile.role),
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  }));

  const { data: departments, error: departmentsError } = await admin
    .from("departments")
    .select("id, name")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (departmentsError) throw new Error(departmentsError.message);

  return {
    users,
    departments: departments ?? [],
    pages: ALL_PAGES.map((id) => ({
      id,
      label: pageLabel(id),
    })),
  };
}

async function listAllAuthUsers(admin: ReturnType<typeof createClient>) {
  const users: { id: string; email?: string }[] = [];
  let page = 1;
  while (page <= 50) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error(error.message);
    users.push(...(data.users ?? []));
    if ((data.users?.length ?? 0) < 200) break;
    page += 1;
  }
  return users;
}

async function createUser(
  admin: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  _callerId: string,
) {
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const displayName = String(body.displayName ?? "").trim() || email;
  const role = parseRole(body.role);
  const departmentId = parseDepartmentId(body.departmentId);
  const allowedPages = parsePages(body.allowedPages, role);

  if (!email || !email.includes("@")) throw new Error("אימייל לא תקין");
  if (password.length < 8) {
    throw new Error("הסיסמה חייבת להכיל לפחות 8 תווים");
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role },
  });
  if (error || !data.user) {
    throw new Error(error?.message ?? "יצירת המשתמש נכשלה");
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      display_name: displayName,
      role,
      department_id: departmentId,
      allowed_pages: role === "admin" ? [] : allowedPages,
    })
    .eq("id", data.user.id);

  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw new Error(profileError.message);
  }

  return { ok: true, id: data.user.id };
}

async function updateUser(
  admin: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
  callerId: string,
) {
  const { data: existing, error: existingError } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing) throw new Error("המשתמש לא נמצא");

  const patch: {
    display_name?: string;
    role?: AppRole;
    department_id?: string | null;
    allowed_pages?: string[];
  } = {};

  if (body.displayName !== undefined) {
    const displayName = String(body.displayName ?? "").trim();
    if (!displayName) throw new Error("שם תצוגה נדרש");
    patch.display_name = displayName;
  }

  if (body.role !== undefined) {
    const role = parseRole(body.role);
    if (
      existing.role === "admin" &&
      role !== "admin" &&
      (await countAdmins(admin)) <= 1
    ) {
      throw new Error("לא ניתן להסיר את מנהל המערכת האחרון");
    }
    if (userId === callerId && role !== "admin") {
      throw new Error("לא ניתן להסיר מעצמך הרשאת מנהל");
    }
    patch.role = role;
  }

  if (body.departmentId !== undefined) {
    patch.department_id = parseDepartmentId(body.departmentId);
  }

  if (body.allowedPages !== undefined || patch.role) {
    const role = patch.role ?? (existing.role as AppRole);
    patch.allowed_pages =
      role === "admin" ? [] : parsePages(body.allowedPages, role);
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from("profiles").update(patch).eq("id", userId);
    if (error) throw new Error(error.message);
  }

  const authPatch: {
    password?: string;
    app_metadata?: { role: AppRole };
  } = {};

  if (body.password !== undefined && String(body.password).length > 0) {
    const password = String(body.password);
    if (password.length < 8) {
      throw new Error("הסיסמה חייבת להכיל לפחות 8 תווים");
    }
    authPatch.password = password;
  }

  if (patch.role) {
    authPatch.app_metadata = { role: patch.role };
  }

  if (Object.keys(authPatch).length > 0) {
    const { error } = await admin.auth.admin.updateUserById(userId, authPatch);
    if (error) throw new Error(error.message);
  }

  return { ok: true };
}

async function deleteUser(
  admin: ReturnType<typeof createClient>,
  userId: string,
  callerId: string,
) {
  if (userId === callerId) {
    throw new Error("לא ניתן למחוק את המשתמש המחובר");
  }

  const { data: existing, error: existingError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing) throw new Error("המשתמש לא נמצא");

  if (existing.role === "admin" && (await countAdmins(admin)) <= 1) {
    throw new Error("לא ניתן למחוק את מנהל המערכת האחרון");
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function countAdmins(admin: ReturnType<typeof createClient>) {
  const { count, error } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function parseRole(value: unknown): AppRole {
  if (value === "admin" || value === "manager" || value === "viewer") {
    return value;
  }
  throw new Error("תפקיד לא תקין");
}

function parseDepartmentId(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function parsePages(value: unknown, role: AppRole): PageKey[] {
  if (role === "admin") return [];
  if (!Array.isArray(value)) {
    throw new Error("רשימת עמודים לא תקינה");
  }
  const pages = value
    .map((item) => String(item))
    .filter((item): item is PageKey =>
      (ALL_PAGES as readonly string[]).includes(item),
    )
    // Sensitive admin surfaces stay admin-only.
    .filter((item) => item !== "settings" && item !== "users");
  if (pages.length === 0) {
    throw new Error("יש לבחור לפחות עמוד אחד");
  }
  return [...new Set(pages)];
}

function normalizePages(pages: string[] | null, role: AppRole): string[] {
  if (role === "admin") return [...ALL_PAGES];
  return (pages ?? []).filter((page) =>
    (ALL_PAGES as readonly string[]).includes(page),
  );
}

function pageLabel(id: PageKey) {
  switch (id) {
    case "dashboard":
      return "ניטור בזמן אמת";
    case "wallboard":
      return "מסך מוקד (TV)";
    case "calls":
      return "היסטוריית שיחות";
    case "recordings":
      return "הקלטות שיחות";
    case "agents":
      return "נציגים וצוותים";
    case "analytics":
      return "דוחות וניתוח";
    case "settings":
      return "הגדרות";
    case "users":
      return "ניהול משתמשים";
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
