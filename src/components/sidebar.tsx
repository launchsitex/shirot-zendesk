"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  Headphones,
  LayoutDashboard,
  LogOut,
  Menu,
  Mic2,
  PhoneCall,
  PanelRightClose,
  Settings,
  UsersRound,
  X,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import {
  createSupabaseBrowserClient,
  isSupabaseBrowserConfigured,
} from "@/lib/supabase/browser";

const items = [
  { href: "/dashboard", label: "ניטור בזמן אמת", icon: LayoutDashboard },
  { href: "/calls", label: "היסטוריית שיחות", icon: PhoneCall },
  { href: "/recordings", label: "הקלטות שיחות", icon: Mic2 },
  { href: "/agents", label: "נציגים וצוותים", icon: UsersRound },
  { href: "/analytics", label: "דוחות וניתוח", icon: BarChart3 },
  { href: "/settings", label: "הגדרות", icon: Settings },
];

function subscribeDesktop(onStoreChange: () => void) {
  const media = window.matchMedia("(min-width: 1024px)");
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function getDesktopSnapshot() {
  return window.matchMedia("(min-width: 1024px)").matches;
}

function getServerDesktopSnapshot() {
  return true;
}

function useIsDesktop() {
  return useSyncExternalStore(
    subscribeDesktop,
    getDesktopSnapshot,
    getServerDesktopSnapshot,
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const isDesktop = useIsDesktop();
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? isDesktop;

  function setOpen(next: boolean) {
    setOverride(next);
  }

  return (
    <>
      <Sidebar open={open} onOpenChange={setOpen} isDesktop={isDesktop} />
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-4 top-4 z-50 rounded-xl bg-[#102d38] p-2.5 text-white shadow-lg"
          aria-label="פתיחת תפריט"
        >
          <Menu size={22} />
        </button>
      )}
      <main
        className={`min-h-screen p-4 transition-[margin] duration-200 lg:p-8 ${
          open ? "pt-4 lg:mr-[238px]" : "pt-20 lg:mr-0"
        }`}
      >
        {children}
      </main>
    </>
  );
}

function Sidebar({
  open,
  onOpenChange,
  isDesktop,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDesktop: boolean;
}) {
  const pathname = usePathname();

  async function signOut() {
    if (isSupabaseBrowserConfigured()) {
      await createSupabaseBrowserClient().auth.signOut();
    }
    window.location.href = "/login";
  }

  return (
    <>
      {open && !isDesktop && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/30"
          onClick={() => onOpenChange(false)}
          aria-label="סגירת תפריט"
        />
      )}
      <aside
        className={`fixed right-0 top-0 z-40 flex h-screen w-[238px] flex-col bg-[#102d38] text-white transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-[86px] items-center gap-3 border-b border-white/10 px-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#1da99b]">
            <Headphones size={24} />
          </span>
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-lg">City Live</strong>
            <span className="text-xs text-white/55">רהיטי הסיטי</span>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/80 transition hover:bg-white/15 hover:text-white"
            aria-label="סגירת תפריט צד"
            title="סגירת תפריט"
          >
            {isDesktop ? <PanelRightClose size={18} /> : <X size={18} />}
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3 pt-7">
          <p className="mb-3 px-3 text-[11px] font-bold tracking-wider text-white/35">
            מרכז בקרה
          </p>
          {items.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  if (!isDesktop) onOpenChange(false);
                }}
                className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition ${
                  active
                    ? "bg-white text-[#102d38] shadow"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <item.icon size={19} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="m-3 rounded-2xl bg-white/8 p-4">
          <div className="mb-3 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e9b24a] font-bold text-[#102d38]">
              רה
            </span>
            <div className="min-w-0">
              <strong className="block truncate text-sm">מנהל מערכת</strong>
              <span className="text-xs text-white/45">גישה מלאה</span>
            </div>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs text-white/60 hover:bg-white/10 hover:text-white"
          >
            <LogOut size={15} />
            יציאה
          </button>
        </div>
        <div className="flex items-center gap-2 border-t border-white/10 px-6 py-4 text-xs text-white/40">
          <Building2 size={14} />
          מוקד שירות ואספקות
        </div>
      </aside>
    </>
  );
}
