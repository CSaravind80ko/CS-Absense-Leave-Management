import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Unplug,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  type ApplicationRole,
  type ScimAdminConnection,
  type ScimAdminGroup,
  type ScimAuditEvent,
  type ScimCredentialIssue,
  type createApiClient,
} from '../lib/api'

type ApiClient = ReturnType<typeof createApiClient>

const mappingRoles: ApplicationRole[] = [
  'EMPLOYEE',
  'AUDITOR',
  'MANAGER',
  'PAYROLL_ADMIN',
  'HR_ADMIN',
  'TENANT_ADMIN',
]
const safeDefaultRoles = mappingRoles.filter(role => role !== 'TENANT_ADMIN')

function date(value?: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Never'
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'The SCIM operation failed.'
}

export function ScimProvisioning({ api }: { api: ApiClient }) {
  const [connections, setConnections] = useState<ScimAdminConnection[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [groups, setGroups] = useState<ScimAdminGroup[]>([])
  const [events, setEvents] = useState<ScimAuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [issued, setIssued] = useState<ScimCredentialIssue | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api.getScimConnections()
      setConnections(result)
      setSelectedId(current => current || result.find(item => item.provisioning?.enabled)?.samlConnectionId || '')
    } catch (caught) {
      setError(message(caught))
    } finally {
      setLoading(false)
    }
  }, [api])

  const loadDetails = useCallback(async (samlConnectionId: string) => {
    if (!samlConnectionId) {
      setGroups([])
      setEvents([])
      return
    }
    try {
      const [nextGroups, nextEvents] = await Promise.all([
        api.getScimGroups(samlConnectionId),
        api.getScimEvents(samlConnectionId),
      ])
      setGroups(nextGroups)
      setEvents(nextEvents)
    } catch (caught) {
      setError(message(caught))
    }
  }, [api])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadDetails(selectedId) }, [loadDetails, selectedId])

  const run = async (key: string, action: () => Promise<unknown>, refreshDetails = false) => {
    setBusy(key)
    setError('')
    try {
      await action()
      await load()
      if (refreshDetails && selectedId) await loadDetails(selectedId)
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy('')
    }
  }

  const issue = async (connection: ScimAdminConnection, rotate: boolean) => {
    if (rotate && !window.confirm('Rotate the SCIM credential now? All existing credentials for this connection will be revoked immediately.')) return
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
    setBusy(`credential-${connection.samlConnectionId}`)
    setError('')
    try {
      const result = rotate
        ? await api.rotateScimCredential(connection.samlConnectionId, { label: '90-day provisioning token', expiresAt })
        : await api.issueScimCredential(connection.samlConnectionId, { label: '90-day provisioning token', expiresAt })
      setIssued(result)
      await load()
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy('')
    }
  }

  const selected = connections.find(connection => connection.samlConnectionId === selectedId)

  return <section className="scim-section" aria-labelledby="scim-title">
    <div className="page-top scim-heading"><div><h2 id="scim-title">SCIM provisioning</h2><p>Provision tenant users and groups from Entra ID or Okta without exposing SAML or Cognito secrets.</p></div></div>
    {error && <div className="state-banner error" role="alert"><AlertTriangle size={18}/><div><b>SCIM administration action failed</b><p>{error}</p></div><button className="secondary small" onClick={() => void load()}><RefreshCw size={14}/> Retry</button></div>}
    {loading ? <div className="panel saml-loading"><LoaderCircle className="spinner" size={24}/> Loading SCIM configuration…</div>
      : <div className="scim-connection-list">{connections.map(connection => {
        const active = connection.provisioning?.enabled === true
        const working = busy.includes(connection.samlConnectionId)
        return <article className="panel scim-card" key={connection.samlConnectionId}>
          <div className="panel-head"><div><h3>{connection.providerName}</h3><p>{connection.identityType === 'DEDICATED_COGNITO' ? 'Dedicated' : 'Shared'} Cognito broker · SAML {connection.samlStatus.toLowerCase()}</p></div><span className={`badge ${active ? 'green' : connection.eligible ? 'amber' : 'neutral'}`}>{active ? 'enabled' : connection.eligible ? 'available' : 'blocked'}</span></div>
          {!connection.eligible && <div className="rule-note"><ShieldAlert size={17}/><div><b>Activation blocked</b><p>Both the SAML connection and linked identity connection must be active.</p></div></div>}
          {active && connection.provisioning ? <>
            <dl className="scim-summary"><div><dt>Users</dt><dd>{connection.provisioning._count.users}</dd></div><div><dt>Groups</dt><dd>{connection.provisioning._count.groups}</dd></div><div><dt>Default role</dt><dd>{connection.provisioning.defaultRole.replaceAll('_', ' ')}</dd></div><div><dt>Last token use</dt><dd>{date(connection.provisioning.credentials.find(item => !item.revokedAt)?.lastUsedAt)}</dd></div></dl>
            <div className="scim-base"><span>Base URL</span><code>{connection.baseUrl}</code><CopyButton value={connection.baseUrl} label="Copy SCIM base URL"/></div>
            <div className="saml-actions">
              <button className="secondary small" disabled={working} onClick={() => { setSelectedId(connection.samlConnectionId); void loadDetails(connection.samlConnectionId) }}><Settings2 size={13}/> Configure</button>
              <button className="secondary small" disabled={working} onClick={() => void issue(connection, false)}><KeyRound size={13}/> Generate token</button>
              <button className="secondary small" disabled={working} onClick={() => void issue(connection, true)}><RefreshCw size={13}/> Rotate token</button>
              <button className="secondary small danger" disabled={working} onClick={() => {
                if (window.confirm('Disable SCIM and revoke every active credential for this connection? Existing users and audit history will be retained.')) {
                  void run(`disable-${connection.samlConnectionId}`, () => api.disableScim(connection.samlConnectionId))
                }
              }}><Unplug size={13}/> Disable</button>
            </div>
            <details className="credential-list"><summary>Credential status ({connection.provisioning.credentials.length})</summary>{connection.provisioning.credentials.map(credential =>
              <div key={credential.id}><span><code>{credential.tokenPrefix}…</code><small>{credential.label} · expires {date(credential.expiresAt)} · last used {date(credential.lastUsedAt)}</small></span><span className={`badge ${credential.revokedAt ? 'neutral' : 'green'}`}>{credential.revokedAt ? 'revoked' : 'active'}</span>{!credential.revokedAt && <button className="secondary small danger" disabled={busy === credential.id} onClick={() => {
                if (window.confirm(`Revoke credential ${credential.tokenPrefix} now? This cannot be undone.`)) {
                  void run(credential.id, () => api.revokeScimCredential(connection.samlConnectionId, credential.id))
                }
              }}>Revoke</button>}</div>,
            )}</details>
          </> : <button className="primary" disabled={!connection.eligible || working} onClick={() => void run(`enable-${connection.samlConnectionId}`, () => api.enableScim(connection.samlConnectionId, 'EMPLOYEE'))}>Enable SCIM</button>}
        </article>
      })}</div>}
    {selected?.provisioning?.enabled && <ScimConfiguration
      connection={selected}
      groups={groups}
      events={events}
      busy={busy}
      run={run}
      api={api}
    />}
    {issued && <OneTimeCredential issued={issued} onClose={() => setIssued(null)}/>}
  </section>
}

function ScimConfiguration({
  connection,
  groups,
  events,
  busy,
  run,
  api,
}: {
  connection: ScimAdminConnection
  groups: ScimAdminGroup[]
  events: ScimAuditEvent[]
  busy: string
  run: (key: string, action: () => Promise<unknown>, refreshDetails?: boolean) => Promise<void>
  api: ApiClient
}) {
  const provisioning = connection.provisioning!
  return <div className="scim-config-grid">
    <section className="panel"><div className="panel-head"><div><h3>Role policy</h3><p>Provider group names never become roles automatically.</p></div></div>
      <label>Safe default role<select value={provisioning.defaultRole} onChange={event => void run('settings', () => api.updateScimSettings(connection.samlConnectionId, {
        defaultRole: event.target.value as ApplicationRole,
        privilegedRolePolicy: provisioning.privilegedRolePolicy,
        confirmPrivilegedAccess: provisioning.privilegedRolePolicy,
      }), true)}>{safeDefaultRoles.map(role => <option key={role} value={role}>{role.replaceAll('_', ' ')}</option>)}</select></label>
      <label className="compact-check privileged-check"><input type="checkbox" checked={provisioning.privilegedRolePolicy} disabled={busy === 'settings'} onChange={event => {
        const enable = event.target.checked
        if (enable && !window.confirm('Allow explicitly confirmed SCIM group mappings to grant TENANT_ADMIN? Provider groups still require a separate confirmed mapping.')) return
        void run('settings', () => api.updateScimSettings(connection.samlConnectionId, {
          defaultRole: provisioning.defaultRole,
          privilegedRolePolicy: enable,
          confirmPrivilegedAccess: enable,
        }), true)
      }}/> Permit confirmed TENANT_ADMIN mappings</label>
    </section>
    <section className="panel"><div className="panel-head"><div><h3>Group role mappings</h3><p>Changes recalculate effective user roles deterministically.</p></div></div>
      {groups.length === 0 ? <p className="muted">No groups have been provisioned.</p> : <div className="mapping-list">{groups.map(group => <div key={group.id}><span><b>{group.displayName}</b><small>{group._count.members} members</small></span><select aria-label={`Role mapping for ${group.displayName}`} value={group.roleMapping?.role ?? ''} disabled={busy === group.id} onChange={event => {
          const role = event.target.value as ApplicationRole | ''
          if (!role) {
            void run(group.id, () => api.removeScimGroupRole(connection.samlConnectionId, group.id), true)
            return
          }
          const privileged = role === 'TENANT_ADMIN'
          if (privileged && !window.confirm(`Grant TENANT_ADMIN to members of ${group.displayName}? This is a privileged mapping.`)) return
          void run(group.id, () => api.mapScimGroupRole(connection.samlConnectionId, group.id, role, privileged), true)
        }}><option value="">Default role</option>{mappingRoles.map(role => <option key={role} value={role} disabled={role === 'TENANT_ADMIN' && !provisioning.privilegedRolePolicy}>{role.replaceAll('_', ' ')}</option>)}</select></div>)}</div>}
    </section>
    <section className="panel scim-events"><div className="panel-head"><div><h3>Recent provisioning events</h3><p>Sanitized audit entries never contain bearer tokens or SCIM payloads.</p></div></div>
      {events.length === 0 ? <p className="muted">No provisioning activity yet.</p> : <ol>{events.slice(0, 12).map(event => <li key={event.id}><span>{event.action.replaceAll('.', ' ')}</span><time dateTime={event.occurredAt}>{date(event.occurredAt)}</time></li>)}</ol>}
    </section>
  </div>
}

function OneTimeCredential({ issued, onClose }: { issued: ScimCredentialIssue; onClose: () => void }) {
  return <div className="overlay form-overlay"><section className="employee-form panel one-time-secret" role="dialog" aria-modal="true" aria-labelledby="scim-token-title"><div className="panel-head"><div><h2 id="scim-token-title">Copy the SCIM credential now</h2><p>The token is shown once and cannot be retrieved later.</p></div><button className="icon-button" aria-label="Close credential dialog" onClick={onClose}><X size={18}/></button></div>
    <div className="state-banner warning"><ShieldAlert size={18}/><div><b>Store this in the identity provider</b><p>Do not paste it into tickets, logs, or application configuration.</p></div></div>
    <label>SCIM base URL<div className="secret-copy"><code>{issued.baseUrl}</code><CopyButton value={issued.baseUrl} label="Copy base URL"/></div></label>
    <label>Bearer token<div className="secret-copy"><code>{issued.token}</code><CopyButton value={issued.token} label="Copy bearer token"/></div></label>
    <div className="wizard-actions"><button className="primary" onClick={onClose}>I have stored the token</button></div>
  </section></div>
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return <button className="secondary small" type="button" aria-label={label} onClick={async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }}>{copied ? <Check size={13}/> : <Copy size={13}/>}<span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span></button>
}
