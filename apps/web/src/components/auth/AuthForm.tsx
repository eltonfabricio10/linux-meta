import { useState } from 'preact/hooks';
import { authClient } from '~/lib/auth-client';

type Mode = 'login' | 'signup';

type Labels = {
  email: string;
  password: string;
  name: string;
  submitLogin: string;
  submitSignup: string;
  switchToLogin: string;
  switchToSignup: string;
  passwordHint: string;
};

export default function AuthForm({ mode, labels, locale }: { mode: Mode; labels: Labels; locale: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === 'login'
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ email, password, name: name || email.split('@')[0]! });
      if (res.error) {
        setError(res.error.message ?? 'Auth failed');
      } else {
        window.location.href = `/${locale}/`;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} class="auth-form" noValidate>
      {mode === 'signup' && (
        <label>
          <span>{labels.name}</span>
          <input
            type="text"
            autoComplete="name"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </label>
      )}

      <label>
        <span>{labels.email}</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
        />
      </label>

      <label>
        <span>{labels.password}</span>
        <input
          type="password"
          required
          minLength={10}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
        />
        {mode === 'signup' && <small>{labels.passwordHint}</small>}
      </label>

      {error && <p class="error" role="alert">{error}</p>}

      <button type="submit" disabled={busy}>
        {busy ? '…' : mode === 'login' ? labels.submitLogin : labels.submitSignup}
      </button>

      <p class="switch">
        <a href={mode === 'login' ? `/${locale}/auth/signup` : `/${locale}/auth/login`}>
          {mode === 'login' ? labels.switchToSignup : labels.switchToLogin}
        </a>
      </p>

      <style>{`
        .auth-form {
          display: grid;
          gap: var(--space-4);
          max-inline-size: 420px;
        }
        .auth-form label { display: grid; gap: var(--space-2); }
        .auth-form label span { font-size: var(--text-sm); color: var(--color-fg-muted); }
        .auth-form input {
          padding: 0.8rem 1rem;
          border: 1.5px solid var(--color-border);
          border-radius: var(--radius-md);
          font: inherit;
          background: var(--color-bg-elevated);
          color: var(--color-fg);
        }
        .auth-form input:focus { border-color: var(--color-teal-500); outline: none; }
        .auth-form small { color: var(--color-fg-muted); font-size: 0.78rem; }
        .auth-form button {
          margin-block-start: var(--space-2);
          padding: 0.9rem 1.4rem;
          border: none;
          border-radius: var(--radius-full);
          background: var(--color-cta);
          color: var(--color-cta-fg);
          font-weight: 700;
          cursor: pointer;
        }
        .auth-form button:disabled { opacity: 0.6; cursor: progress; }
        .error {
          background: color-mix(in srgb, var(--color-terra-400) 18%, transparent);
          color: var(--color-terra-600);
          padding: var(--space-3) var(--space-4);
          border-radius: var(--radius-md);
          margin: 0;
          font-size: 0.92rem;
        }
        .switch a { color: var(--color-teal-700); text-decoration: none; font-size: 0.92rem; }
        .switch a:hover { text-decoration: underline; }
      `}</style>
    </form>
  );
}
