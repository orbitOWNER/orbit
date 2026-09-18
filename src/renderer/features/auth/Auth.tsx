import React, { useState } from 'react';
import { useAuth } from '../../stores/useAuth';
import { useUI } from '../../stores/useUI';

export function AuthPage() {
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);
  const status = useAuth((s) => s.status);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const toast = useUI((s) => s.toast);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register({ email: email.trim(), password, username: username.trim(), displayName: displayName.trim() || username.trim() });
      toast('success', 'Welcome to Orbit');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card" role="main" aria-label="Sign in">
        <div className="auth-brand"><span className="orbit-mark lg">◍</span><h1>Orbit</h1><p className="muted">Your communities, in orbit.</p></div>
        <div className="auth-tabs" role="tablist">
          <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'sel' : ''} onClick={() => setMode('login')}>Log in</button>
          <button role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'sel' : ''} onClick={() => setMode('register')}>Register</button>
        </div>
        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && (
            <>
              <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} required minLength={2} maxLength={32} placeholder="nova" autoComplete="username" /></label>
              <label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={64} placeholder="Nova" autoComplete="nickname" /></label>
            </>
          )}
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@orbit.local" autoComplete="email" /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} placeholder="••••••••" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="btn primary block" type="submit" disabled={status === 'loading'}>{status === 'loading' ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
        </form>
      </div>
    </div>
  );
}
