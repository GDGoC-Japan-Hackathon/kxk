"use client";

import { useEffect, useState } from "react";
import { MarketStrip } from "@/components/MarketStrip";
import { SiteHeader } from "@/components/SiteHeader";
import { clearStoredToken, fetchMe, updateSettings } from "@/lib/api";

export default function SettingsPage() {
  const [email, setEmail] = useState<string>("");
  const [newsletter, setNewsletter] = useState(true);
  const [message, setMessage] = useState<string | undefined>();

  useEffect(() => {
    fetchMe()
      .then((profile) => {
        setEmail(profile.email);
        setNewsletter(Boolean(profile.settings?.newsletter ?? true));
      })
      .catch(() => {
        setEmail("Not signed in");
      });
  }, []);

  return (
    <main className="screen-shell">
      <SiteHeader />
      <MarketStrip />

      <section className="auth-shell">
        <div className="panel auth-card">
          <p className="kicker">Settings</p>
          <h1>Email preferences</h1>
          <p className="text-[var(--wl-muted)]">Account: {email}</p>

          <label className="market-check-row mt-4">
            <input type="checkbox" checked={newsletter} onChange={(event) => setNewsletter(event.target.checked)} />
            <span>Receive risk summary emails</span>
          </label>

          <button
            className="btn-primary mt-4"
            type="button"
            onClick={async () => {
              try {
                await updateSettings(newsletter);
                setMessage("Settings saved.");
              } catch {
                setMessage("Could not save settings.");
              }
            }}
          >
            Save settings
          </button>

          <button
            className="btn-secondary mt-2"
            type="button"
            onClick={() => {
              clearStoredToken();
              setMessage("Signed out.");
            }}
          >
            Sign out
          </button>

          {message && <p className="state-msg !px-0 !py-2">{message}</p>}
        </div>
      </section>
    </main>
  );
}
