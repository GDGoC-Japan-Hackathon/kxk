"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { MarketStrip } from "@/components/MarketStrip";
import { SiteHeader } from "@/components/SiteHeader";
import { setStoredToken, signup } from "@/lib/api";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [newsletter, setNewsletter] = useState(true);
  const [message, setMessage] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setMessage("Passwords do not match.");
      return;
    }

    setLoading(true);
    setMessage(undefined);

    try {
      const auth = await signup(email, password, newsletter);
      setStoredToken(auth.token);
      setMessage("Account created. Redirecting...");
      router.push("/app");
    } catch (err) {
      const parsed = err as Error;
      setMessage(parsed.message || "Sign up failed");
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
          <p className="kicker">Create account</p>
          <h1>Start your risk intelligence workspace</h1>
          <form className="mt-4 space-y-3" onSubmit={onSubmit}>
            <input className="text-input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input
              className="text-input"
              type="password"
              placeholder="Password (8+ chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
            <input
              className="text-input"
              type="password"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            <button className="btn-primary w-full" type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create account"}
            </button>
            <label className="market-check-row">
              <input type="checkbox" checked={newsletter} onChange={(event) => setNewsletter(event.target.checked)} />
              <span>Email newsletter opt-in</span>
            </label>
          </form>

          {message && <p className="state-msg !px-0 !py-2">{message}</p>}
          <p className="mt-3 text-sm text-[var(--wl-muted)]">
            Already have an account? <Link href="/login">Sign in</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
