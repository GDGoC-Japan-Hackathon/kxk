"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clearStoredToken } from "@/lib/api";
import { useAuthProfile } from "@/lib/hooks";

const navItems = [
  { href: "/", label: "Home", submenu: [{ href: "/", label: "Overview" }] },
  {
    href: "/world",
    label: "World",
    submenu: [
      { href: "/world?mode=map", label: "2D News Situation Room" },
      { href: "/world?mode=globe", label: "3D Air & Maritime Globe" },
    ],
  },
  { href: "/news", label: "News", submenu: [{ href: "/news", label: "Global News Intelligence" }] },
  {
    href: "/charts",
    label: "Charts",
    submenu: [{ href: "/charts", label: "Cross-Asset Charts" }],
  },
  {
    href: "/chat",
    label: "Chat",
    submenu: [{ href: "/chat", label: "Macro Analyst Chat" }],
  },
  {
    href: "/portfolio",
    label: "Portfolio",
    submenu: [
      { href: "/portfolio", label: "Input" },
      { href: "/portfolio/report", label: "Risk Report" },
      { href: "/app", label: "Dashboard" },
    ],
  },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { profile } = useAuthProfile();

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="brand-lockup">
          <span className="brand-dot" />
          <div>
            <strong>WorldLens</strong>
            <p>See the World. Know Your Risk.</p>
          </div>
        </Link>

        <nav className="site-nav" aria-label="Primary">
          {navItems.map((item) => (
            <div key={item.href} className="nav-item">
              <Link
                href={item.href}
                className={(item.label === "World" ? pathname === "/map" || pathname === "/world" : pathname === item.href) ? "active" : ""}
              >
                {item.label}
              </Link>
              <div className="nav-submenu">
                {item.submenu.map((entry) => (
                  <Link key={entry.href} href={entry.href}>
                    {entry.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
          {profile && (
            <div className="nav-item">
              <button type="button" className="nav-account-btn">
                Account
              </button>
              <div className="nav-submenu">
                <Link href="/portfolio">Portfolio</Link>
                <Link href="/settings">Settings</Link>
                <button
                  type="button"
                  onClick={() => {
                    clearStoredToken();
                    window.location.href = "/";
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
