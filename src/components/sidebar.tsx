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
  Settings,
  UsersRound,
  X,
} from "lucide-react";
import { useState } from "react";
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

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  async function signOut() {
    if (isSupabaseBrowserConfigured()) {
      await createSupabaseBrowserClient().auth.signOut();
    }
    window.location.href = "/login";
  }

  return (
    <>
      <button
        className="fixed right-4 top-4 z-50 rounded-xl bg-[#102d38] p-2 text-white lg:hidden"
        onClick={() => setOpen(!open)}
        aria-label="פתיחת תפריט"
      >
        {open ? <X /> : <Menu />}
      </button>
      {open && (
        <button
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setOpen(false)}
          aria-label="סגירת תפריט"
        />
      )}
      <aside
        className={`fixed right-0 top-0 z-40 flex h-screen w-[238px] flex-col bg-[#102d38] text-white transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-[86px] items-center gap-3 border-b border-white/10 px-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1da99b]">
            <Headphones size={24} />
          </span>
          <div>
            <strong className="block text-lg">City Live</strong>
            <span className="text-xs text-white/55">רהיטי הסיטי</span>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3 pt-7">
          <p className="mb-3 px-3 text-[11px] font-bold tracking-wider text-white/35">
            מרכז בקרה
          </p>
          {items.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
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
