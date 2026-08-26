import { useState, type FormEvent } from 'react'
import { AlertTriangle, LoaderCircle, LockKeyhole } from 'lucide-react'
import { missingAuthConfig } from './config'
import { useAuth } from './useAuth'

const cognitoSpecialCharacters = "^$*.[]{}()?-\"!@#%&/\\,><':;|_~`"

function AuthShell({ children }: { children: React.ReactNode }) {
  return <main className="auth-page"><section className="auth-card"><div className="auth-brand">S&P</div>{children}</section></main>
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status, signIn, completeNewPassword, signOut } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')

  if (status === 'misconfigured') {
    return <AuthShell><AlertTriangle className="auth-icon warning" size={30}/><h1>Authentication is not configured</h1><p>Add the following values to the frontend environment and restart the app.</p><ul className="config-list">{missingAuthConfig.map(name => <li key={name}><code>{name}</code></li>)}</ul></AuthShell>
  }
  if (status === 'loading') {
    return <AuthShell><LoaderCircle className="auth-icon spinner" size={32}/><h1>Restoring your session</h1><p>Securely checking your Amazon Cognito session…</p></AuthShell>
  }
  if (status === 'authenticated') return children

  const submitNewPassword = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (newPassword !== confirmation) {
      setError('Passwords do not match.')
      return
    }
    if (newPassword.length < 8 || newPassword.length > 256) {
      setError('Password must be between 8 and 256 characters.')
      return
    }
    const hasSpecialCharacter = [...newPassword].some(character => cognitoSpecialCharacters.includes(character))
    if (!/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword) || !hasSpecialCharacter) {
      setError('Use at least one uppercase letter, lowercase letter, number, and special character.')
      return
    }
    setSubmitting(true)
    try {
      await completeNewPassword(newPassword)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Your password could not be changed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'newPasswordRequired') {
    return <AuthShell><LockKeyhole className="auth-icon" size={30}/><h1>Choose a new password</h1><p>Amazon Cognito requires a permanent password before you can continue.</p><form className="auth-form" onSubmit={submitNewPassword}><label>New password<input type="password" autoComplete="new-password" autoFocus required minLength={8} maxLength={256} value={newPassword} onChange={event => setNewPassword(event.target.value)}/></label><small className="password-hint">8–256 characters with uppercase, lowercase, number, and special character.</small><label>Confirm new password<input type="password" autoComplete="new-password" required minLength={8} maxLength={256} value={confirmation} onChange={event => setConfirmation(event.target.value)}/></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="primary full" disabled={submitting}>{submitting ? <><LoaderCircle className="spinner" size={16}/> Updating password…</> : 'Set password and continue'}</button><button className="text-button auth-signout" type="button" onClick={signOut}>Cancel and sign out</button></form></AuthShell>
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await signIn(username, password)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in failed. Check your credentials and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return <AuthShell><LockKeyhole className="auth-icon" size={30}/><h1>HR administrator sign in</h1><p>Use your organization’s Amazon Cognito credentials.</p><form className="auth-form" onSubmit={submit}><label>Email or username<input autoComplete="username" autoFocus required value={username} onChange={event => setUsername(event.target.value)}/></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}/></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="primary full" disabled={submitting}>{submitting ? <><LoaderCircle className="spinner" size={16}/> Signing in…</> : 'Sign in'}</button></form></AuthShell>
}
