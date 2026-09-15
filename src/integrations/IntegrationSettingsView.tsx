import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, LoaderCircle, Plus, Sparkles, X } from 'lucide-react'
import {
  ApiError,
  type ApiClient,
  type ApplicationRole,
  type AttendanceSourceConnection,
  type AttendanceSourceConnectionStatus,
  type AttendanceSourceType,
} from '../lib/api'

type Notify = (message: string, kind?: 'success' | 'warning') => void

const label = (value: string) => value.replaceAll('_', ' ').toLowerCase()
const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Something went wrong.'
const formatDate = (value: string | null) =>
  value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'

const SOURCE_TYPES: AttendanceSourceType[] = ['ESSL_BIOMETRIC', 'GREYTHR', 'SFTP', 'MANUAL_FILE']

const STATUS_TONE: Record<AttendanceSourceConnectionStatus, string> = {
  DRAFT: 'neutral',
  READY: 'blue',
  ACTIVE: 'green',
  DISABLED: 'red',
}

const FORWARD_STATUS: Partial<Record<AttendanceSourceConnectionStatus, AttendanceSourceConnectionStatus[]>> = {
  DRAFT: ['READY'],
  READY: ['ACTIVE', 'DISABLED'],
  ACTIVE: ['DISABLED'],
  DISABLED: ['READY'],
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

function LoadState({ loading, error, empty, retry }: { loading: boolean; error: string; empty: boolean; retry: () => void }) {
  if (loading) return <div className="empty-panel panel"><LoaderCircle className="spinner" size={25}/><h2>Loading</h2></div>
  if (error) return <div className="empty-panel panel"><AlertTriangle size={25}/><h2>Something went wrong</h2><p className="form-error">{error}</p><button className="primary" onClick={retry}>Retry</button></div>
  if (empty) return <div className="empty-panel panel"><Sparkles size={25}/><h2>No source connections yet</h2><p>Add a connection to track how ESSL, greytHR, SFTP, or manual file sources are configured.</p></div>
  return null
}

interface CreateDraft {
  type: AttendanceSourceType
  name: string
  configText: string
  credentialReference: string
}

export function IntegrationSettingsView({ api, role, notify }: { api: ApiClient; role: ApplicationRole; notify: Notify }) {
  const canManage = role === 'TENANT_ADMIN' || role === 'HR_ADMIN'
  const [connections, setConnections] = useState<AttendanceSourceConnection[]>([])
  const [selected, setSelected] = useState<AttendanceSourceConnection>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<CreateDraft>()
  const [draftError, setDraftError] = useState('')
  const [saving, setSaving] = useState('')
  const [syncForm, setSyncForm] = useState({ status: 'SUCCESS' as 'SUCCESS' | 'FAILED', recordCount: '', note: '' })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setConnections(await api.getSourceConnections()) } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api])
  useEffect(() => { void load() }, [load])

  const openDetail = async (id: string) => {
    try { setSelected(await api.getSourceConnection(id)) } catch (caught) { notify(errorMessage(caught), 'warning') }
  }

  const openCreate = () => setDraft({ type: 'ESSL_BIOMETRIC', name: '', configText: '{}', credentialReference: '' })

  const submitCreate = async () => {
    if (!draft) return
    setDraftError('')
    if (!draft.name.trim()) { setDraftError('Name is required.'); return }
    let config: Record<string, unknown> | undefined
    if (draft.configText.trim()) {
      try { config = JSON.parse(draft.configText) } catch { setDraftError('Config must be valid JSON.'); return }
    }
    setSaving('create')
    try {
      await api.createSourceConnection({
        type: draft.type,
        name: draft.name.trim(),
        config,
        credentialReference: draft.credentialReference.trim() || undefined,
      })
      setDraft(undefined)
      await load()
      notify('Connection created.')
    } catch (caught) { setDraftError(errorMessage(caught)) } finally { setSaving('') }
  }

  const transition = async (connection: AttendanceSourceConnection, status: AttendanceSourceConnectionStatus) => {
    setSaving(connection.id)
    try {
      await api.transitionSourceConnection(connection.id, status)
      await load()
      if (selected?.id === connection.id) await openDetail(connection.id)
      notify(`Connection moved to ${label(status)}.`)
    } catch (caught) { notify(errorMessage(caught), 'warning') } finally { setSaving('') }
  }

  const submitSyncLog = async () => {
    if (!selected) return
    setSaving('sync-log')
    try {
      await api.recordSourceConnectionSync(selected.id, {
        status: syncForm.status,
        recordCount: syncForm.recordCount ? Number(syncForm.recordCount) : undefined,
        note: syncForm.note.trim() || undefined,
      })
      setSyncForm({ status: 'SUCCESS', recordCount: '', note: '' })
      await openDetail(selected.id)
      await load()
      notify('Sync outcome recorded.')
    } catch (caught) { notify(errorMessage(caught), 'warning') } finally { setSaving('') }
  }

  const state = <LoadState loading={loading} error={error} empty={connections.length === 0} retry={() => void load()}/>

  return <>
    <div className="page-top">
      <p>Source-system connection settings and sync history. Live vendor syncing is wired in as each integration goes live; until then, outcomes are logged manually for audit visibility.</p>
      {canManage && <button className="primary" onClick={openCreate}><Plus size={16}/> Add connection</button>}
    </div>
    {(loading || error || connections.length === 0) ? state : <section className="panel table-panel"><table><thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Last sync</th><th>Actions</th></tr></thead><tbody>{connections.map(connection => <tr key={connection.id} className={connection.id === selected?.id ? 'selected-row' : ''}><td><button className="text-button" onClick={() => void openDetail(connection.id)}><b>{connection.name}</b></button></td><td>{label(connection.type)}</td><td><Badge tone={STATUS_TONE[connection.status]}>{label(connection.status)}</Badge></td><td>{connection.lastSyncAt ? <>{formatDate(connection.lastSyncAt)}<small className="subline">{connection.lastSyncStatus} · {connection.lastSyncRecordCount ?? 0} records</small></> : '—'}</td><td><div className="table-actions">{canManage && (FORWARD_STATUS[connection.status] ?? []).map(next => <button key={next} className={next === 'DISABLED' ? 'secondary small' : 'approve'} disabled={saving === connection.id} onClick={() => void transition(connection, next)}>{saving === connection.id ? 'Saving…' : `Move to ${label(next)}`}</button>)}</div></td></tr>)}</tbody></table></section>}

    {draft && <div className="detail-panel"><div className="detail-head"><div><small>NEW CONNECTION</small><h2>Add source connection</h2></div><button className="icon-button" onClick={() => setDraft(undefined)}><X size={18}/></button></div>
      {draftError && <p className="form-error">{draftError}</p>}
      <label>Type<select value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value as AttendanceSourceType })}>{SOURCE_TYPES.map(type => <option key={type} value={type}>{label(type)}</option>)}</select></label>
      <label>Name<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. ESSL biometric - HQ"/></label>
      <label>Config (JSON)<textarea value={draft.configText} onChange={event => setDraft({ ...draft, configText: event.target.value })} placeholder='{"host": "sftp.example.com", "path": "/exports"}'/></label>
      <label>Credential reference<input value={draft.credentialReference} onChange={event => setDraft({ ...draft, credentialReference: event.target.value })} placeholder="Pointer to a secret elsewhere, e.g. secrets-manager:essl-hq"/></label>
      <button className="primary full" disabled={saving === 'create'} onClick={() => void submitCreate()}>{saving === 'create' ? <><LoaderCircle className="spinner" size={16}/> Creating</> : 'Create connection'}</button>
    </div>}

    {selected && <div className="detail-panel"><div className="detail-head"><div><small>SOURCE CONNECTION</small><h2>{selected.name}</h2><p>{label(selected.type)}</p></div><button className="icon-button" onClick={() => setSelected(undefined)}><X size={18}/></button></div>
      <div className="detail-status"><Badge tone={STATUS_TONE[selected.status]}>{label(selected.status)}</Badge>{selected.credentialReference && <span>Credential: <b>{selected.credentialReference}</b></span>}</div>
      {selected.config && <div className="timeline-detail"><h3>Config</h3><p>{Object.entries(selected.config).map(([key, value]) => `${key}: ${String(value)}`).join(' · ') || 'Empty'}</p></div>}
      <div className="timeline-detail"><h3>Sync history</h3>{!selected.syncLogs?.length ? <p>No sync outcomes recorded yet.</p> : selected.syncLogs.map(log => <p key={log.id}><i></i><b>{formatDate(log.occurredAt)}</b><span> · <Badge tone={log.status === 'SUCCESS' ? 'green' : 'red'}>{log.status}</Badge> · {log.recordCount ?? 0} records{log.note ? ` · ${log.note}` : ''}</span></p>)}</div>
      {canManage && <section className="freeze-row panel"><div><div><b>Record a sync outcome</b><p>Until this source syncs automatically, log the outcome here for the audit trail.</p></div></div>
        <select value={syncForm.status} onChange={event => setSyncForm({ ...syncForm, status: event.target.value as 'SUCCESS' | 'FAILED' })}><option value="SUCCESS">Success</option><option value="FAILED">Failed</option></select>
        <input type="number" min="0" value={syncForm.recordCount} onChange={event => setSyncForm({ ...syncForm, recordCount: event.target.value })} placeholder="Record count"/>
        <input value={syncForm.note} onChange={event => setSyncForm({ ...syncForm, note: event.target.value })} placeholder="Note"/>
        <button className="primary" disabled={saving === 'sync-log'} onClick={() => void submitSyncLog()}>Log outcome</button>
      </section>}
    </div>}
  </>
}
