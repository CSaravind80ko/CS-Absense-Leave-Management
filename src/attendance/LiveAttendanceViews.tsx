import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Download,
  FileUp,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react'
import {
  ApiError,
  type ApiClient,
  type ApplicationRole,
  type ApprovalRequest,
  type AttendanceDashboard,
  type AttendanceDayDetail,
  type AttendanceException,
  type AttendanceImportJob,
  type AttendanceRegisterItem,
  type ExceptionPage,
  type Page,
  type PayrollRegister,
  type PayrollExport,
  type PeriodStatus,
  type ProcessingPeriod,
} from '../lib/api'

type Notify = (message: string, kind?: 'success' | 'warning') => void

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
const formatTime = (value: string | null) =>
  value ? new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(value)) : '—'
const formatMinutes = (value: number) => `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, '0')}m`
const label = (value: string) => value.replaceAll('_', ' ').toLowerCase()
const errorMessage = (error: unknown) =>
  error instanceof ApiError && error.status === 409
    ? `${error.message} The record was updated by someone else.`
    : error instanceof Error
      ? error.message
      : 'The request could not be completed.'

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

function LoadState({
  loading,
  error,
  empty,
  retry,
}: {
  loading: boolean
  error: string
  empty: boolean
  retry: () => void
}) {
  if (loading) return <section className="empty-panel panel"><LoaderCircle className="spinner" size={25}/><h2>Loading live attendance data</h2></section>
  if (error) return <section className="empty-panel panel"><AlertTriangle size={25}/><h2>Attendance data could not be loaded</h2><p className="form-error">{error}</p><button className="primary" onClick={retry}><RefreshCw size={15}/> Retry</button></section>
  if (empty) return <section className="empty-panel panel"><CheckCircle2 size={25}/><h2>No records for this period</h2><p>The live database has no matching records. Import processing has not been connected yet.</p></section>
  return null
}

export function LiveDashboard({
  api,
  period,
  setView,
}: {
  api: ApiClient
  period: ProcessingPeriod
  setView: (view: 'Data Import Centre' | 'Exception Workbench' | 'Payroll Register') => void
}) {
  const [data, setData] = useState<AttendanceDashboard>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setData(await api.getAttendanceDashboard(period.id)) } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api, period.id])
  useEffect(() => { void load() }, [load])
  const state = <LoadState loading={loading} error={error} empty={!data} retry={() => void load()}/>
  if (loading || error || !data) return state
  const metrics = [
    [data.metrics.activeEmployees, 'Active employees'],
    [data.metrics.attendanceProcessed, 'Attendance processed'],
    [data.metrics.payrollReady, 'Payroll ready'],
    [data.metrics.openExceptions, 'Open exceptions'],
    [data.metrics.criticalBlockers, 'Critical blockers'],
    [data.metrics.pendingApprovals, 'Pending approvals'],
  ] as const
  return <>
    <div className="page-top"><p>Live operational overview for {period.name}.</p><Badge tone={data.metrics.criticalBlockers ? 'red' : 'green'}>{period.status}</Badge></div>
    <div className="metric-grid">{metrics.map(([value, title], index) => <div className="metric" key={title}><div className={`metric-icon i${index}`}>{index > 2 ? <AlertTriangle size={18}/> : <CheckCircle2 size={18}/>}</div><div><strong>{value}</strong><span>{title}</span><small>PostgreSQL-backed</small></div></div>)}</div>
    <div className="dashboard-grid">
      <section className="panel readiness"><div className="panel-head"><div><h2>Payroll readiness</h2><p>{formatDate(period.startsOn)} – {formatDate(period.endsOn)}</p></div><Badge tone="blue">{period.status}</Badge></div><div className="readiness-body"><div className="donut"><b>{data.metrics.readinessPercent}%</b><span>ready</span></div><div className="progress-list"><p><span><i className="green-dot"></i> Payroll ready</span><b>{data.metrics.payrollReady} employees</b></p><p><span><i className="red-dot"></i> Critical blockers</span><b>{data.metrics.criticalBlockers} employees</b></p><button className="text-button" onClick={() => setView('Payroll Register')}>View payroll register <ArrowRight size={15}/></button></div></div></section>
      <section className="panel action-panel"><h2>Period actions</h2><p>Private file ingestion and payroll generation run asynchronously.</p><button onClick={() => setView('Data Import Centre')}><span>1</span> Upload attendance <Badge tone="green">Worker backed</Badge></button><button onClick={() => setView('Exception Workbench')}><span>2</span> Resolve exceptions <Badge tone={data.metrics.openExceptions ? 'red' : 'green'}>{data.metrics.openExceptions} open</Badge></button></section>
      <section className="panel activity"><div className="panel-head"><div><h2>Recent audited activity</h2><p>Latest persisted workflow actions</p></div></div>{data.recentActivity.length === 0 ? <p className="muted">No audited actions yet.</p> : data.recentActivity.map(item => <div className="activity-row" key={item.id}><span className="activity-icon success"><CheckCircle2 size={14}/></span><div><b>{label(item.action)}</b><small>{item.actorSubject}</small></div><time>{formatDate(item.occurredAt)}</time></div>)}</section>
    </div>
  </>
}

const FORWARD_STATUS: Partial<Record<PeriodStatus, PeriodStatus>> = {
  OPEN: 'PROCESSING',
  PROCESSING: 'REVIEW',
  REVIEW: 'APPROVED',
  APPROVED: 'EXPORTED',
  EXPORTED: 'CLOSED',
}
const REOPEN_STATUS: Partial<Record<PeriodStatus, PeriodStatus>> = {
  PROCESSING: 'OPEN',
  REVIEW: 'PROCESSING',
  APPROVED: 'REVIEW',
  EXPORTED: 'REVIEW',
}

export function ProcessingPeriodsView({
  api,
  periods,
  selectedPeriodId,
  onSelect,
  onRefresh,
  role,
  notify,
}: {
  api: ApiClient
  periods: ProcessingPeriod[]
  selectedPeriodId: string
  onSelect: (id: string) => void
  onRefresh: () => Promise<void>
  role: ApplicationRole
  notify: Notify
}) {
  const [reason, setReason] = useState('')
  const [draft, setDraft] = useState({ name: '', startsOn: '', endsOn: '' })
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const canManage = role === 'TENANT_ADMIN' || role === 'HR_ADMIN'
  const transition = async (period: ProcessingPeriod, status: PeriodStatus, reopen = false) => {
    if (reopen && reason.trim().length < 3) {
      setError('Enter a reopen reason of at least three characters.')
      return
    }
    setSaving(period.id)
    setError('')
    try {
      await api.transitionAttendancePeriod(period.id, { status, version: period.version, reason: reopen ? reason.trim() : undefined })
      setReason('')
      await onRefresh()
      notify(`Period moved to ${label(status)}.`)
    } catch (caught) { setError(errorMessage(caught)) } finally { setSaving('') }
  }
  const createPeriod = async () => {
    if (!draft.name.trim() || !draft.startsOn || !draft.endsOn) {
      setError('Name, start date, and end date are required.')
      return
    }
    setSaving('create')
    setError('')
    try {
      const created = await api.createAttendancePeriod({ ...draft, name: draft.name.trim() })
      setDraft({ name: '', startsOn: '', endsOn: '' })
      await onRefresh()
      onSelect(created.id)
      notify('Processing period created.')
    } catch (caught) { setError(errorMessage(caught)) } finally { setSaving('') }
  }
  return <>
    <div className="page-top"><p>Explicit, versioned processing lifecycle with blocker checks and audited reopen actions.</p><Badge tone="blue">{periods.length} periods</Badge></div>
    {error && <div className="alert-box"><AlertTriangle size={18}/><div><b>Period action failed</b><p>{error}</p></div></div>}
    {canManage && <section className="freeze-row panel"><div><CalendarIcon/><div><b>Create processing period</b><p>Overlapping tenant periods are rejected by the API.</p></div></div><input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder="Period name"/><input type="date" value={draft.startsOn} onChange={event => setDraft(current => ({ ...current, startsOn: event.target.value }))}/><input type="date" value={draft.endsOn} onChange={event => setDraft(current => ({ ...current, endsOn: event.target.value }))}/><button className="primary" disabled={saving === 'create'} onClick={() => void createPeriod()}>Create</button></section>}
    {periods.length === 0 ? <LoadState loading={false} error="" empty retry={() => void onRefresh()}/> : <section className="panel table-panel"><table><thead><tr><th>Period</th><th>Dates</th><th>Status</th><th>Version</th><th>Updated</th><th>Actions</th></tr></thead><tbody>{periods.map(period => <tr key={period.id} className={period.id === selectedPeriodId ? 'selected-row' : ''}><td><button className="text-button" onClick={() => onSelect(period.id)}><b>{period.name}</b></button></td><td>{formatDate(period.startsOn)} – {formatDate(period.endsOn)}</td><td><Badge tone={period.status === 'CLOSED' ? 'green' : period.status === 'APPROVED' ? 'blue' : 'amber'}>{label(period.status)}</Badge></td><td>v{period.version}</td><td>{formatDate(period.updatedAt)}</td><td><div className="table-actions">{canManage && FORWARD_STATUS[period.status] && <button className="approve" disabled={saving === period.id} onClick={() => void transition(period, FORWARD_STATUS[period.status]!)}>{saving === period.id ? 'Saving…' : `Move to ${label(FORWARD_STATUS[period.status]!)}`}</button>}{canManage && REOPEN_STATUS[period.status] && period.id === selectedPeriodId && <button className="secondary small" disabled={saving === period.id} onClick={() => void transition(period, REOPEN_STATUS[period.status]!, true)}>Reopen</button>}</div></td></tr>)}</tbody></table></section>}
    {canManage && selectedPeriodId && REOPEN_STATUS[periods.find(item => item.id === selectedPeriodId)?.status ?? 'CLOSED'] && <section className="freeze-row panel"><div><ShieldCheck size={22}/><div><b>Audited reopen reason</b><p>Required before moving this period back into correction.</p></div></div><input value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain why this period must be reopened"/></section>}
  </>
}

function CalendarIcon() {
  return <CalendarDays size={22}/>
}

export function ImportCentreView({ api, period, role, notify }: { api: ApiClient; period: ProcessingPeriod; role: ApplicationRole; notify: Notify }) {
  const [jobs, setJobs] = useState<AttendanceImportJob[]>([])
  const [file, setFile] = useState<File>()
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setJobs((await api.getAttendanceImports(period.id)).items) } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api, period.id])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!jobs.some(job => job.status === 'PENDING' || job.status === 'PROCESSING')) return
    const timer = window.setInterval(() => void load(), 2000)
    return () => window.clearInterval(timer)
  }, [jobs, load])
  const canRequest = role === 'TENANT_ADMIN' || role === 'HR_ADMIN'
  const requestImport = async () => {
    if (!file) { setError('Choose a CSV or XLSX file before starting the import.'); return }
    setUploading(true)
    setError('')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map(value => value.toString(16).padStart(2, '0'))
        .join('')
      const contentType = file.name.toLowerCase().endsWith('.csv')
        ? 'text/csv'
        : file.name.toLowerCase().endsWith('.xlsx')
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : ''
      if (!contentType) throw new Error('Only .csv and .xlsx attendance templates are supported.')
      const { job } = await api.requestAttendanceImport(period.id, 'MANUAL_FILE')
      const upload = await api.createAttendanceImportUpload(job.id, {
        fileName: file.name,
        contentType,
        sizeBytes: file.size,
        checksumSha256: checksum,
      })
      await api.uploadAttendanceFile(upload, file)
      await api.finalizeAttendanceImport(job.id, upload.uploadId)
      setFile(undefined)
      await load()
      notify('File uploaded securely. Attendance validation is running.')
    } catch (caught) { setError(errorMessage(caught)) } finally { setUploading(false) }
  }
  const state = <LoadState loading={loading} error={error} empty={false} retry={() => void load()}/>
  if (loading || error) return state
  return <>
    <div className="page-top"><p>Upload CSV or XLSX directly to private storage, then track real worker validation.</p><Badge tone="green">Worker connected</Badge></div>
    {canRequest && <section className="freeze-row panel"><div><FileUp size={22}/><div><b>Import attendance punches</b><p>Required columns: employeeNumber, occurredAt, punchType.</p></div></div><input aria-label="Attendance file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => setFile(event.target.files?.[0])}/><button className="primary" disabled={!file || uploading} onClick={() => void requestImport()}>{uploading ? <><LoaderCircle className="spinner" size={16}/> Uploading</> : <><Upload size={16}/> Upload and validate</>}</button></section>}
    <div aria-live="polite">{jobs.length === 0 ? <LoadState loading={false} error="" empty retry={() => void load()}/> : <section className="panel table-panel"><table><thead><tr><th>Request</th><th>Status</th><th>Accepted</th><th>Rejected</th><th>Days updated</th><th>Exceptions</th><th>Failure</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id}><td><b>{job.id.slice(0, 8)}</b><small className="subline">{formatDate(job.createdAt)}</small></td><td><Badge tone={job.status === 'FAILED' ? 'red' : job.status === 'COMPLETED' ? 'green' : 'amber'}>{label(job.status)}</Badge></td><td>{job.acceptedRows}</td><td>{job.rejectedRows}</td><td>{job.attendanceDaysUpdated}</td><td>{job.exceptionsOpened}</td><td>{job.errorCode ? <span className="critical-text">{label(job.errorCode)}</span> : '—'}</td></tr>)}</tbody></table></section>}</div>
  </>
}

export function AttendanceRegisterView({ api, period }: { api: ApiClient; period: ProcessingPeriod }) {
  const [data, setData] = useState<Page<AttendanceRegisterItem>>()
  const [detail, setDetail] = useState<AttendanceDayDetail>()
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await api.getAttendanceRegister(period.id, { search })) } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api, period.id, search])
  useEffect(() => { const timer = window.setTimeout(() => void load(), 200); return () => window.clearTimeout(timer) }, [load])
  const open = async (id: string) => {
    try { setDetail(await api.getAttendanceDay(id)) } catch (caught) { setError(errorMessage(caught)) }
  }
  const state = <LoadState loading={loading} error={error} empty={!data?.items.length} retry={() => void load()}/>
  return <>
    <div className="page-top"><p>Tenant-scoped daily attendance and source evidence for {period.name}.</p><div className="search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search employee"/></div></div>
    {(loading || error || !data?.items.length) ? state : <section className="panel table-panel"><table><thead><tr><th>Employee</th><th>Date</th><th>First punch</th><th>Last punch</th><th>Worked</th><th>Status</th><th>Readiness</th></tr></thead><tbody>{data.items.map(day => <tr key={day.id} onClick={() => void open(day.id)}><td><b>{day.employee.employeeNumber}</b><small className="subline">{day.employee.firstName} {day.employee.lastName}</small></td><td>{formatDate(day.workDate)}</td><td>{formatTime(day.firstPunchAt)}</td><td>{formatTime(day.lastPunchAt)}</td><td>{formatMinutes(day.workedMinutes)}</td><td><Badge tone={day.status === 'PRESENT' ? 'green' : 'amber'}>{label(day.status)}</Badge></td><td><Badge tone={day.exceptions.length ? 'red' : 'green'}>{day.exceptions.length ? 'Blocked' : 'Ready'}</Badge></td></tr>)}</tbody></table></section>}
    {detail && <div className="detail-panel"><div className="detail-head"><div><small>EMPLOYEE-DAY ATTENDANCE</small><h2>{detail.employee.firstName} {detail.employee.lastName}</h2><p>{formatDate(detail.workDate)} · {detail.employee.employeeNumber}</p></div><button className="icon-button" onClick={() => setDetail(undefined)}><X size={18}/></button></div><div className="detail-status"><Badge tone={detail.exceptions.length ? 'red' : 'green'}>{label(detail.status)}</Badge><span>Version <b>{detail.version}</b></span></div><div className="timeline-detail"><h3>Persisted punch timeline</h3>{detail.punches.length === 0 ? <p>No source punches are linked to this date.</p> : detail.punches.map(punch => <p key={punch.id}><i></i><b>{formatTime(punch.occurredAt)}</b><span>{label(punch.type)} · {punch.source}{punch.location ? ` · ${punch.location.name}` : ''}</span></p>)}</div><button className="primary full" onClick={() => setDetail(undefined)}>Close detail</button></div>}
  </>
}

export function ExceptionWorkbenchView({ api, period, role, notify }: { api: ApiClient; period: ProcessingPeriod; role: ApplicationRole; notify: Notify }) {
  const [data, setData] = useState<ExceptionPage>()
  const [selected, setSelected] = useState<AttendanceException>()
  const [note, setNote] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const canDecide = ['TENANT_ADMIN', 'HR_ADMIN', 'MANAGER'].includes(role)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await api.getExceptions(period.id, { search })) } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api, period.id, search])
  useEffect(() => { const timer = window.setTimeout(() => void load(), 200); return () => window.clearTimeout(timer) }, [load])
  const decide = async (decision: 'RESOLVED' | 'DISMISSED') => {
    if (!selected || note.trim().length < 3) { setError('Enter a decision note of at least three characters.'); return }
    try {
      await api.decideException(selected.id, { decision, note: note.trim(), version: selected.version })
      setSelected(undefined); setNote(''); await load(); notify(`Exception ${label(decision)} with an audit record.`)
    } catch (caught) { setError(errorMessage(caught)) }
  }
  const state = <LoadState loading={loading} error={error} empty={!data?.items.length} retry={() => void load()}/>
  return <>
    <div className="page-top"><p>Resolve persisted attendance exceptions with mandatory notes and optimistic concurrency.</p><div className="search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search employee"/></div></div>
    {data && <div className="exception-summary"><div><b>{data.summary.open}</b><span>Open exceptions</span></div><div><b className="critical-text">{data.summary.critical}</b><span>Critical</span></div><div><b>{data.summary.blocked}</b><span>Payroll blocked</span></div></div>}
    {(loading || error || !data?.items.length) ? state : <section className="panel table-panel"><table><thead><tr><th>Employee / date</th><th>Type</th><th>Severity</th><th>Payroll impact</th><th>Assigned to</th><th>Status</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id} onClick={() => { setSelected(item); setError('') }}><td><b>{item.employee ? `${item.employee.firstName} ${item.employee.lastName}` : String(item.details?.employeeNumber ?? 'Unknown employee')}</b><small className="subline">{item.attendanceDay ? formatDate(item.attendanceDay.workDate) : 'Import validation'}</small></td><td>{label(item.type)}</td><td><Badge tone={item.severity === 'CRITICAL' ? 'red' : item.severity === 'HIGH' ? 'orange' : 'amber'}>{label(item.severity)}</Badge></td><td>{label(item.payrollImpact)}</td><td>{item.assignedToSubject ?? (item.assignedToRole ? label(item.assignedToRole) : 'Unassigned')}</td><td><Badge tone={item.status === 'OPEN' ? 'red' : 'green'}>{label(item.status)}</Badge></td></tr>)}</tbody></table></section>}
    {selected && <div className="detail-panel"><div className="detail-head"><div><small>ATTENDANCE EXCEPTION</small><h2>{label(selected.type)}</h2><p>{selected.employee ? `${selected.employee.firstName} ${selected.employee.lastName}` : String(selected.details?.employeeNumber ?? 'Unknown employee')}</p></div><button className="icon-button" onClick={() => setSelected(undefined)}><X size={18}/></button></div><div className="detail-status"><Badge tone={selected.severity === 'CRITICAL' ? 'red' : 'amber'}>{selected.severity}</Badge><span>Payroll impact: <b>{label(selected.payrollImpact)}</b></span></div><label>Decision reason<textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Record the evidence and accountable decision"/></label>{canDecide ? <div className="wizard-actions"><button className="secondary" onClick={() => void decide('DISMISSED')}>Dismiss</button><button className="primary" onClick={() => void decide('RESOLVED')}>Resolve</button></div> : <p className="form-error">Your role can review but cannot decide this exception.</p>}</div>}
  </>
}

export function ApprovalInboxView({ api, period, notify }: { api: ApiClient; period: ProcessingPeriod; notify: Notify }) {
  const [data, setData] = useState<Page<ApprovalRequest>>()
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await api.getApprovals({ periodId: period.id, status: 'PENDING', scope: 'inbox' })) } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api, period.id])
  useEffect(() => { void load() }, [load])
  const act = async (request: ApprovalRequest, action: 'APPROVED' | 'REJECTED') => {
    if (action === 'REJECTED' && comment.trim().length < 1) { setError('Enter a comment before rejecting an approval.'); return }
    try {
      await api.actOnApproval(request.id, { action, version: request.version, comment: comment.trim() || undefined })
      setComment(''); await load(); notify(`Approval ${label(action)} and history appended.`)
    } catch (caught) { setError(errorMessage(caught)) }
  }
  const state = <LoadState loading={loading} error={error} empty={!data?.items.length} retry={() => void load()}/>
  return <>
    <div className="page-top"><p>Requests assigned to your authenticated tenant role for {period.name}.</p><Badge tone="amber">{data?.total ?? 0} awaiting action</Badge></div>
    <section className="freeze-row panel"><div><ShieldCheck size={22}/><div><b>Decision comment</b><p>Required for rejection; retained in immutable approval history.</p></div></div><input value={comment} onChange={event => setComment(event.target.value)} placeholder="Add context for this decision"/></section>
    {(loading || error || !data?.items.length) ? state : <section className="panel table-panel"><table><thead><tr><th>Request</th><th>Target</th><th>Submitted by</th><th>History</th><th>Decision</th></tr></thead><tbody>{data.items.map(request => <tr key={request.id}><td><b>{request.id.slice(0, 8)}</b><small className="subline">{label(request.type)}</small></td><td>{request.period?.name ?? (request.exception ? (request.exception.employee ? `${request.exception.employee.firstName} ${request.exception.employee.lastName}` : String(request.exception.details?.employeeNumber ?? 'Unknown employee')) : '—')}</td><td>{request.requestedBy}</td><td>{request.actions.length} actions</td><td><div className="table-actions"><button className="approve" onClick={() => void act(request, 'APPROVED')}>Approve</button><button className="secondary small" onClick={() => void act(request, 'REJECTED')}>Reject</button></div></td></tr>)}</tbody></table></section>}
  </>
}

export function PayrollRegisterView({ api, period, role, notify }: { api: ApiClient; period: ProcessingPeriod; role: ApplicationRole; notify: Notify }) {
  const [data, setData] = useState<PayrollRegister>()
  const [exports, setExports] = useState<PayrollExport[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [register, exportPage] = await Promise.all([
        api.getPayrollRegister(period.id, search),
        api.getPayrollExports(period.id),
      ])
      setData(register)
      setExports(exportPage.items)
    } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api, period.id, search])
  useEffect(() => { const timer = window.setTimeout(() => void load(), 200); return () => window.clearTimeout(timer) }, [load])
  useEffect(() => {
    if (!exports.some(item => item.status === 'DRAFT' || item.status === 'GENERATING')) return
    const timer = window.setInterval(() => void load(), 2000)
    return () => window.clearInterval(timer)
  }, [exports, load])
  const canExport = ['TENANT_ADMIN', 'HR_ADMIN', 'PAYROLL_ADMIN'].includes(role)
  const requestExport = async (format: 'CSV' | 'XLSX') => {
    try {
      await api.requestPayrollExport(period.id, period.version, format)
      await load()
      notify(`${format} payroll generation started.`)
    } catch (caught) { setError(errorMessage(caught)) }
  }
  const download = async (item: PayrollExport) => {
    try {
      const result = await api.getPayrollExportDownload(item.id)
      window.location.assign(result.downloadUrl)
    } catch (caught) { setError(errorMessage(caught)) }
  }
  const state = <LoadState loading={loading} error={error} empty={!data?.items.length} retry={() => void load()}/>
  return <>
    <div className="page-top"><p>Calculated employee totals and worker-generated private exports.</p><div className="search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search employee"/></div>{canExport && <><button className="secondary" disabled={period.status !== 'APPROVED' || Boolean(data?.readiness.blocked)} onClick={() => void requestExport('CSV')}><Download size={16}/> CSV</button><button className="primary" disabled={period.status !== 'APPROVED' || Boolean(data?.readiness.blocked)} onClick={() => void requestExport('XLSX')}><Download size={16}/> XLSX</button></>}</div>
    {data && <div className="payroll-metrics"><div><b>{data.readiness.ready}</b><span>Employees payroll ready</span></div><div><b className="critical-text">{data.readiness.blocked}</b><span>Blocked by critical exceptions</span></div><div><b>{data.readiness.readinessPercent}%</b><span>Readiness</span></div></div>}
    {data?.readiness.blocked ? <div className="alert-box"><AlertTriangle size={18}/><div><b>Payroll release is blocked</b><p>Resolve all critical or BLOCKED-impact exceptions before approval or export.</p></div></div> : null}
    {(loading || error || !data?.items.length) ? state : <section className="panel table-panel"><table><thead><tr><th>Employee</th><th>Department</th><th>Attendance days</th><th>Regular</th><th>Overtime</th><th>Unpaid</th><th>Readiness</th></tr></thead><tbody>{data.items.map(item => <tr key={item.employee.id}><td><b>{item.employee.employeeNumber}</b><small className="subline">{item.employee.firstName} {item.employee.lastName}</small></td><td>{item.employee.department?.name ?? '—'}</td><td>{item.attendanceDays}</td><td>{formatMinutes(item.regularMinutes)}</td><td>{formatMinutes(item.overtimeMinutes)}</td><td>{formatMinutes(item.unpaidMinutes)}</td><td><Badge tone={item.readiness === 'READY' ? 'green' : 'red'}>{label(item.readiness)}</Badge></td></tr>)}</tbody></table></section>}
    <section className="panel table-panel" aria-live="polite"><div className="panel-head"><div><h2>Generated exports</h2><p>Downloads use short-lived authenticated URLs.</p></div><Badge tone="green">Private objects</Badge></div>{exports.length === 0 ? <p className="muted">No exports requested for this period.</p> : <table><thead><tr><th>Format</th><th>Version</th><th>Status</th><th>Items</th><th>Created</th><th>Action</th></tr></thead><tbody>{exports.map(item => <tr key={item.id}><td>{item.format}</td><td>{item.periodVersion}</td><td><Badge tone={item.status === 'READY' ? 'green' : item.status === 'FAILED' ? 'red' : 'amber'}>{label(item.status)}</Badge>{item.errorCode && <small className="subline critical-text">{label(item.errorCode)}</small>}</td><td>{item._count.items}</td><td>{formatDate(item.createdAt)}</td><td>{item.status === 'READY' ? <button className="secondary small" onClick={() => void download(item)}><Download size={14}/> Download</button> : '—'}</td></tr>)}</tbody></table>}</section>
  </>
}
