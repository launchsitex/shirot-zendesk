export const APP_PAGES = [
  { id: "dashboard", href: "/dashboard", label: "ניטור בזמן אמת" },
  { id: "wallboard", href: "/wallboard", label: "מסך מוקד (TV)" },
  { id: "calls", href: "/calls", label: "היסטוריית שיחות" },
  {
    id: "after-hours",
    href: "/after-hours",
    label: "שיחות אחרי שעות הפעילות",
  },
  { id: "recordings", href: "/recordings", label: "הקלטות שיחות" },
  { id: "agents", href: "/agents", label: "נציגים וצוותים" },
  { id: "analytics", href: "/analytics", label: "דוחות וניתוח" },
  { id: "status-report", href: "/status-report", label: "זמני סטטוס נציגים" },
  { id: "system-logs", href: "/system-logs", label: "לוג מערכת" },
  { id: "settings", href: "/settings", label: "הגדרות" },
  { id: "users", href: "/users", label: "ניהול משתמשים" },
] as const;

export type AppPageId = (typeof APP_PAGES)[number]["id"];
export type AppRole = "admin" | "manager" | "viewer";

export type AppProfile = {
  id: string;
  displayName: string | null;
  role: AppRole;
  departmentId: string | null;
  allowedPages: AppPageId[];
};

export const DEFAULT_ALLOWED_PAGES: AppPageId[] = [
  "dashboard",
  "wallboard",
  "calls",
  "after-hours",
  "recordings",
  "agents",
  "analytics",
];

export function canAccessPage(
  profile: Pick<AppProfile, "role" | "allowedPages"> | null | undefined,
  pageId: AppPageId,
): boolean {
  if (!profile) return false;
  if (profile.role === "admin") return true;
  if (
    pageId === "settings" ||
    pageId === "users" ||
    pageId === "system-logs"
  ) {
    return false;
  }
  return profile.allowedPages.includes(pageId);
}

export function resolveAllowedPages(
  role: AppRole,
  allowedPages: string[] | null | undefined,
): AppPageId[] {
  if (role === "admin") {
    return APP_PAGES.map((page) => page.id);
  }
  const allowed = new Set(
    (allowedPages ?? []).filter((page): page is AppPageId =>
      APP_PAGES.some((item) => item.id === page),
    ),
  );
  if (allowed.size === 0) {
    return [...DEFAULT_ALLOWED_PAGES];
  }
  return APP_PAGES.map((page) => page.id).filter((id) => allowed.has(id));
}

export function pageIdFromPath(pathname: string): AppPageId | null {
  const match = APP_PAGES.find(
    (page) => pathname === page.href || pathname.startsWith(`${page.href}/`),
  );
  return match?.id ?? null;
}

/** First page the user may open — never assume /dashboard. */
export function getHomeHref(
  profile: Pick<AppProfile, "role" | "allowedPages"> | null | undefined,
): string {
  if (!profile) return "/login";
  const home = APP_PAGES.find((page) => canAccessPage(profile, page.id));
  return home?.href ?? "/login";
}
