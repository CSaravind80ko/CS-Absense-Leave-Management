import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, LoaderCircle, Sparkles, X } from 'lucide-react'
import { ApiError, type ApiClient, type AuditEvent } from '../lib/api'

const label = (value: string) => value.replaceAll('_', ' ').replaceAll('.', ' · ').toLowerCase()
const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Something went wrong.'
const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value))

function actionTone(action: string): string {
  if (action.endsWith('.deleted') || action.includes('.failed') || action.includes('.recompute.completed')) return 'red'
  if (action.endsWith('.created') || action.endsWith('.published') || action.endsWith('.approved')) return 'green'
  if (action.endsWith('.updated') || action.includes('.processing')) return 'amber'
  return 'neutral'
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

function LoadState({ loading, error, empty, retry }: { loading: boolean; error: string; empty: boolean; retry: () => void }) {
  if (loading) return <div className="empty-panel panel"><LoaderCircle className="spinner" size={25}/><h2>Loading</h2></div>
  if (error) return <div className="empty-panel panel"><AlertTriangle size={25}/><h2>Something went wrong</h2><p className="form-error">{error}</p><button className="primary" onClick={retry}>Retry</button></div>
  if (empty) return <div className="empty-panel panel"><Sparkles size={25}/><h2>No matching events</h2></div>
  return null
}

function JsonBlock({ title, value }: { title: string; value: Record<string, unknown> | null }) {
  if (!value) return null
  return <div className="timeline-detail">
    <h3>{title}</h3>
    <pre style={{ overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: 12.5 }}>
      {JSON.stringify(value, null, 2)}
    </pre>
  </div>
}

export function AuditTrailView({ api }: { api: ApiClient }) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [entityTypes, setEntityTypes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [entityTypeFilter, setEntityTypeFilter] = useState('')
  const [actorFilter, setActorFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [selected, setSelected] = useState<AuditEvent>()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await api.getAuditEvents({
        entityType: entityTypeFilter || undefined,
        actorSubject: actorFilter.trim() || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        pageSize: 100,
      })
      setEvents(result.items)
    } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api, entityTypeFilter, actorFilter, dateFrom, dateTo])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    api.getAuditEventEntityTypes().then(setEntityTypes).catch(() => {
      // The entity-type dropdown is a convenience filter; leave it empty if this fails.
    })
  }, [api])

  const state = <LoadState loading={loading} error={error} empty={events.length === 0} retry={() => void load()}/>

  return <>
    <div className="page-top"><p>Every create, update, publish, and delete across the platform — policies, holidays, shifts, groups, approvals, recomputes — in one searchable trail.</p></div>
    <div className="filter-bar">
      <select aria-label="Entity type" value={entityTypeFilter} onChange={event => setEntityTypeFilter(event.target.value)}>
        <option value="">All entity types</option>
        {entityTypes.map(type => <option key={type} value={type}>{type}</option>)}
      </select>
      <input value={actorFilter} onChange={event => setActorFilter(event.target.value)} placeholder="Filter by actor" onBlur={() => void load()} onKeyDown={event => { if (event.key === 'Enter') void load() }}/>
      <label>From <input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)}/></label>
      <label>To <input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)}/></label>
    </div>
    {(loading || error || events.length === 0) ? state : <section className="panel table-panel"><table><thead><tr><th>Occurred</th><th>Actor</th><th>Action</th><th>Entity</th></tr></thead><tbody>
      {events.map(event => <tr key={event.id} onClick={() => setSelected(event)}>
        <td>{formatDateTime(event.occurredAt)}</td>
        <td>{event.actorSubject}</td>
        <td><Badge tone={actionTone(event.action)}>{label(event.action)}</Badge></td>
        <td>{event.entityType}{event.entityId ? <small className="subline">{event.entityId.slice(0, 8)}</small> : null}</td>
      </tr>)}
    </tbody></table></section>}

    {selected && <div className="detail-panel">
      <div className="detail-head">
        <div><small>AUDIT EVENT</small><h2>{label(selected.action)}</h2><p>{formatDateTime(selected.occurredAt)} · {selected.actorSubject}</p></div>
        <button className="icon-button" onClick={() => setSelected(undefined)}><X size={18}/></button>
      </div>
      <div className="detail-status">
        <Badge tone={actionTone(selected.action)}>{label(selected.action)}</Badge>
        <span>{selected.entityType}{selected.entityId ? ` · ${selected.entityId}` : ''}</span>
      </div>
      <JsonBlock title="Before" value={selected.before}/>
      <JsonBlock title="After" value={selected.after}/>
      <JsonBlock title="Metadata" value={selected.metadata}/>
      {!selected.before && !selected.after && !selected.metadata && <p>No additional detail was recorded for this event.</p>}
      <button className="primary full" onClick={() => setSelected(undefined)}>Close</button>
    </div>}
  </>
}
