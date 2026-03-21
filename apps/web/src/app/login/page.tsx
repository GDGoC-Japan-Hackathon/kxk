"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { MarketStrip } from "@/components/MarketStrip";
import { SiteHeader } from "@/components/SiteHeader";
import { joinWaitlist, login, setStoredToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage(undefined);
    try {
      const auth = await login(email, password);
      setStoredToken(auth.token);
      setMessage("Signed in. Redirecting...");
      router.push("/app");
    } catch (err) {
      const parsed = err as Error;
      setMessage(parsed.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="screen-shell">
      <SiteHeader />
      <MarketStrip />

      <section className="auth-shell">
        <div className="panel auth-card">
          <p className="kicker">Sign in</p>
          <h1>Welcome back to WorldLens</h1>
          <p className="text-[var(--wl-muted)]">Email/password authentication.</p>

          <form className="mt-4 space-y-3" onSubmit={onSubmit}>
            <input className="text-input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input
              className="text-input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button className="btn-primary w-full" type="submit" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          {message && <p className="state-msg !px-0 !py-2">{message}</p>}

          <div className="mt-3 grid gap-2">
            <button type="button" className="btn-secondary w-full" disabled>
              Continue with Google
            </button>
            <button type="button" className="btn-secondary w-full" disabled>
              Continue with Apple
            </button>
          </div>

          <div className="mt-4 flex justify-between text-sm text-[var(--wl-muted)]">
            <Link href="/signup">Create account</Link>
            <button
              type="button"
              onClick={async () => {
                if (!email) {
                  setMessage("Enter email to join waitlist.");
                  return;
                }
                await joinWaitlist(email);
                setMessage("Added to waitlist.");
              }}
            >
              Join waitlist
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
