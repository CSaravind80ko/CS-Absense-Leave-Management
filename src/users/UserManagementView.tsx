import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, KeyRound, LoaderCircle, MailPlus, RefreshCw, ShieldCheck, UserCheck, UserX, X } from 'lucide-react'
import {
  ApiError,
  createApiClient,
  type ApplicationRole,
  type TenantUser,
} from '../lib/api'

interface UserManagementViewProps {
  getAccessToken: () => Promise<string>
  tenantId: string
}

const roles: ApplicationRole[] = [
  'TENANT_ADMIN',
  'HR_ADMIN',
  'MANAGER',
  'PAYROLL_ADMIN',
  'EMPLOYEE',
  'AUDITOR',
]

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) {
    return 'Only tenant administrators can manage user access.'
  }
  return error instanceof Error ? error.message : 'The user operation failed.'
}

export function UserManagementView({
  getAccessToken,
  tenantId,
}: UserManagementViewProps) {
  const api = useMemo(
    () => createApiClient({ getAccessToken, tenantId }),
    [getAccessToken, tenantId],
  )
  const [users, setUsers] = useState<TenantUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [inviting, setInviting] = useState(false)
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setUsers(await api.getTenantUsers())
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id)
    setError('')
    try {
      await action()
      await load()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusyId('')
    }
  }

  return <>
    <div className="page-top"><p>Invite local Cognito users and administer tenant-scoped roles, MFA policy, and access lifecycle.</p><button className="primary" onClick={() => setInviting(true)}><MailPlus size={16}/> Invite user</button></div>
    {error && <div className="state-banner error" role="alert"><AlertTriangle size={18}/><div><b>User management action failed</b><p>{error}</p></div><button className="secondary small" onClick={() => void load()}><RefreshCw size={14}/> Retry</button></div>}
    {loading ? <section className="panel empty-state"><LoaderCircle className="spinner" size={30}/><h2>Loading tenant users</h2><p>Retrieving membership and Cognito MFA state…</p></section>
      : <section className="panel table-panel user-table"><div className="panel-head"><div><h2>Users and roles</h2><p>Cognito credentials stay server-side; TOTP secrets are never returned.</p></div><span className="badge green">{users.filter(user => user.active).length} active</span></div>
        <table><thead><tr><th>User</th><th>Role</th><th>MFA</th><th>Lifecycle</th><th>Actions</th></tr></thead><tbody>{users.map(user => {
          const busy = busyId === user.id
          return <tr key={user.id}><td><b>{user.email ?? 'Unlinked membership'}</b><small className="subline">{user.cognitoStatus}</small></td><td><select aria-label={`Role for ${user.email}`} value={user.role} disabled={busy} onChange={event => void run(user.id, () => api.assignTenantUserRole(user.id, event.target.value as ApplicationRole))}>{roles.map(role => <option key={role} value={role}>{role.replaceAll('_', ' ')}</option>)}</select></td><td><div><b>{user.mfaStatus === 'TOTP_ENABLED' ? 'TOTP enabled' : user.mfaStatus === 'NOT_ENROLLED' ? 'Not enrolled' : 'Unknown'}</b><small className="subline">{user.mfaEnforcedByPool ? 'Required by pool' : user.mfaRequired ? 'Policy needs pool enforcement' : 'Optional'}</small></div><label className="compact-check"><input type="checkbox" checked={user.mfaRequired || user.mfaEnforcedByPool} disabled={busy || user.mfaEnforcedByPool} onChange={event => void run(user.id, () => api.setTenantUserMfa(user.id, event.target.checked))}/> Require</label></td><td><span className={`badge ${user.active ? 'green' : 'amber'}`}>{user.lifecycleStatus.replaceAll('_', ' ').toLowerCase()}</span></td><td><div className="user-actions">{user.active ? <button className="secondary small" disabled={busy} onClick={() => void run(user.id, () => api.disableTenantUser(user.id))}><UserX size={13}/> Disable</button> : <button className="secondary small" disabled={busy} onClick={() => void run(user.id, () => api.enableTenantUser(user.id))}><UserCheck size={13}/> Enable</button>}<button className="secondary small" disabled={busy || user.lifecycleStatus !== 'INVITED'} onClick={() => void run(user.id, () => api.resendTenantUserInvitation(user.id))}><MailPlus size={13}/> Resend</button><button className="secondary small" disabled={busy} onClick={() => void run(user.id, () => api.resetTenantUserPassword(user.id))}><KeyRound size={13}/> Reset</button></div></td></tr>
        })}</tbody></table>
        {users.length === 0 && <div className="empty-state"><ShieldCheck size={30}/><h2>No tenant users</h2><p>Invite the first local user to this organization.</p></div>}
      </section>}
    {inviting && <InviteUserDialog api={api} onClose={() => setInviting(false)} onInvited={async () => { setInviting(false); await load() }}/>}
  </>
}

function InviteUserDialog({
  api,
  onClose,
  onInvited,
}: {
  api: ReturnType<typeof createApiClient>
  onClose: () => void
  onInvited: () => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ApplicationRole>('EMPLOYEE')
  const [mfaRequired, setMfaRequired] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api.inviteTenantUser({ email: email.trim().toLowerCase(), role, mfaRequired })
      await onInvited()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  return <div className="overlay form-overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className="employee-form panel" role="dialog" aria-modal="true" aria-labelledby="invite-user-title"><div className="panel-head"><div><h2 id="invite-user-title">Invite local user</h2><p>Cognito sends the temporary-password invitation and handles first-login password and MFA challenges.</p></div><button className="icon-button" type="button" aria-label="Close" onClick={onClose}><X size={18}/></button></div><form onSubmit={submit}><div className="form-grid"><label>Email<input type="email" required autoFocus value={email} onChange={event => setEmail(event.target.value)}/></label><label>Application role<select value={role} onChange={event => setRole(event.target.value as ApplicationRole)}>{roles.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label><label className="compact-check"><input type="checkbox" checked={mfaRequired} onChange={event => setMfaRequired(event.target.checked)}/> Require MFA on the selected connection</label></div>{error && <div className="form-error" role="alert">{error}</div>}<div className="wizard-actions"><button className="secondary" type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving ? <><LoaderCircle className="spinner" size={15}/> Sending…</> : 'Send invitation'}</button></div></form></section></div>
}
