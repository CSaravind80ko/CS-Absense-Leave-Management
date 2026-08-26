import { useState, type FormEvent } from 'react'
import { AlertTriangle, Building2, LoaderCircle, LockKeyhole } from 'lucide-react'
import { missingAuthConfig } from './config'
import { useAuth } from './useAuth'

function AuthShell({ children }: { children: React.ReactNode }) {
  return <main className="auth-page"><section className="auth-card"><div className="auth-brand">S&P</div>{children}</section></main>
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status, error: authError, signIn } = useAuth()
  const [organization, setOrganization] = useState('')
  const [error, setError] = useState('')

  if (status === 'misconfigured') {
    return <AuthShell><AlertTriangle className="auth-icon warning" size={30}/><h1>Authentication is not configured</h1><p>Correct the following frontend environment values and restart the app.</p><ul className="config-list">{missingAuthConfig.map(name => <li key={name}><code>{name}</code></li>)}</ul></AuthShell>
  }
  if (status === 'loading') {
    return <AuthShell><LoaderCircle className="auth-icon spinner" size={32}/><h1>Restoring your session</h1><p>Securely checking your identity session…</p></AuthShell>
  }
  if (status === 'redirecting') {
    return <AuthShell><LoaderCircle className="auth-icon spinner" size={32}/><h1>Opening secure sign in</h1><p>Redirecting to your organization’s managed identity experience…</p></AuthShell>
  }
  if (status === 'authenticated') return children

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const routingKey = organization.trim().toLowerCase()
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(routingKey)) {
      setError('Enter your organization slug or verified domain.')
      return
    }
    await signIn(routingKey)
  }

  return <AuthShell><LockKeyhole className="auth-icon" size={30}/><h1>Sign in to your organization</h1><p>We’ll route you to the correct secure sign-in experience. Passwords and MFA are handled by your identity provider.</p><form className="auth-form" onSubmit={submit}><label>Organization slug or verified domain<div className="input-with-icon"><Building2 size={15}/><input autoComplete="organization" autoFocus required placeholder="example or example.com" value={organization} onChange={event => setOrganization(event.target.value)}/></div></label>{(error || authError) && <div className="form-error" role="alert">{error || authError}</div>}<button className="primary full">Continue securely</button></form></AuthShell>
}
