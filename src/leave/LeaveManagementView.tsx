import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, LoaderCircle, Plus, Sparkles, X } from 'lucide-react'
import {
  ApiError,
  type ApiClient,
  type ApplicationRole,
  type Employee,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveRequestStatus,
  type LeaveType,
  type OnDutyCategory,
  type OnDutyRequest,
  type OnDutyRequestStatus,
} from '../lib/api'

type Notify = (message: string, kind?: 'success' | 'warning') => void

const label = (value: string) => value.replaceAll('_', ' ').toLowerCase()
const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Something went wrong.'
const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))

const STATUS_TONE: Record<LeaveRequestStatus, string> = {
  PENDING: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
  CANCELLED: 'neutral',
}

const ON_DUTY_CATEGORIES: OnDutyCategory[] = ['CLIENT_VISIT', 'GOVERNMENT_OFFICE', 'TRAINING', 'CONFERENCE', 'OTHER']

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

function LoadState({ loading, error, empty, retry }: { loading: boolean; error: string; empty: boolean; retry: () => void }) {
  if (loading) return <div className="empty-panel panel"><LoaderCircle className="spinner" size={25}/><h2>Loading</h2></div>
  if (error) return <div className="empty-panel panel"><AlertTriangle size={25}/><h2>Something went wrong</h2><p className="form-error">{error}</p><button className="primary" onClick={retry}>Retry</button></div>
  if (empty) return <div className="empty-panel panel"><Sparkles size={25}/><h2>Nothing here yet</h2></div>
  return null
}

export function LeaveManagementView({ api, role, notify }: { api: ApiClient; role: ApplicationRole; notify: Notify }) {
  const isAdmin = role === 'TENANT_ADMIN' || role === 'HR_ADMIN'
  const [tab, setTab] = useState<'leave' | 'onDuty' | 'types' | 'balances'>('leave')
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])

  const loadLeaveTypes = useCallback(async () => {
    try { setLeaveTypes(await api.getLeaveTypes()) } catch {
      // Used for pickers only; the requests panel surfaces its own load errors.
    }
  }, [api])
  useEffect(() => { void loadLeaveTypes() }, [loadLeaveTypes])

  return <>
    <div className="tabs">
      <button className={tab === 'leave' ? 'selected' : ''} onClick={() => setTab('leave')}>Leave</button>
      <button className={tab === 'onDuty' ? 'selected' : ''} onClick={() => setTab('onDuty')}>On-Duty</button>
      {isAdmin && <button className={tab === 'types' ? 'selected' : ''} onClick={() => setTab('types')}>Leave types</button>}
      {isAdmin && <button className={tab === 'balances' ? 'selected' : ''} onClick={() => setTab('balances')}>Balances</button>}
    </div>

    {tab === 'leave' && <LeaveRequestsPanel api={api} isAdmin={isAdmin} leaveTypes={leaveTypes} notify={notify}/>}
    {tab === 'onDuty' && <OnDutyRequestsPanel api={api} isAdmin={isAdmin} notify={notify}/>}
    {isAdmin && tab === 'types' && <LeaveTypesPanel api={api} onChanged={loadLeaveTypes} notify={notify}/>}
    {isAdmin && tab === 'balances' && <BalancesPanel api={api} leaveTypes={leaveTypes} notify={notify}/>}
  </>
}

interface SubmitForm {
  leaveTypeId: string
  startDate: string
  endDate: string
  halfDay: boolean
  reason: string
}

function LeaveRequestsPanel({ api, isAdmin, leaveTypes, notify }: {
  api: ApiClient; isAdmin: boolean; leaveTypes: LeaveType[]; notify: Notify
}) {
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<LeaveRequestStatus | ''>('')
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [form, setForm] = useState<SubmitForm>()
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<LeaveRequest>()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await api.getLeaveRequests({ status: statusFilter || undefined, pageSize: 100 })
      setRequests(result.items)
    } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api, statusFilter])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (isAdmin) return
    api.getLeaveBalances().then(setBalances).catch(() => {
      // Balance strip is a convenience; the requests list already surfaces its own errors.
    })
  }, [api, isAdmin])

  const openSubmit = () => setForm({
    leaveTypeId: leaveTypes[0]?.id ?? '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    halfDay: false,
    reason: '',
  })

  const submit = async () => {
    if (!form) return
    setFormError('')
    if (!form.leaveTypeId) { setFormError('Choose a leave type.'); return }
    setSaving(true)
    try {
      await api.submitLeaveRequest({
        leaveTypeId: form.leaveTypeId,
        startDate: form.startDate,
        endDate: form.endDate,
        halfDay: form.halfDay,
        reason: form.reason.trim() || undefined,
      })
      notify('Leave request submitted for approval.')
      setForm(undefined)
      await load()
    } catch (caught) { setFormError(errorMessage(caught)) } finally { setSaving(false) }
  }

  const cancel = async (request: LeaveRequest) => {
    const approval = request.approvalRequests[0]
    if (!approval) { notify('No linked approval was found for this request.', 'warning'); return }
    try {
      await api.actOnApproval(approval.id, {
        action: 'CANCELLED', version: approval.version, comment: 'Cancelled by requester',
      })
      notify('Leave request cancelled.')
      setSelected(undefined)
      await load()
    } catch (caught) { notify(errorMessage(caught), 'warning') }
  }

  const state = <LoadState loading={loading} error={error} empty={requests.length === 0} retry={() => void load()}/>

  return <>
    <div className="page-top">
      <p>{isAdmin ? 'All leave requests across the organization.' : 'Your leave requests. Approval routes to your reporting manager.'}</p>
      <button className="primary" onClick={openSubmit}><Plus size={16}/> Raise leave request</button>
    </div>
    {!isAdmin && balances.length > 0 && <div className="balance-grid">
      {balances.map(b => <div className="panel balance-card" key={b.id}>
        <b>{(Number(b.allocatedDays) - Number(b.usedDays)).toFixed(1)}</b>
        <span>{b.leaveType.name}</span>
        <small>Available</small>
      </div>)}
    </div>}
    <div className="filter-bar">
      <select aria-label="Status" value={statusFilter} onChange={event => setStatusFilter(event.target.value as LeaveRequestStatus | '')}>
        <option value="">All statuses</option>
        <option value="PENDING">Pending</option>
        <option value="APPROVED">Approved</option>
        <option value="REJECTED">Rejected</option>
        <option value="CANCELLED">Cancelled</option>
      </select>
    </div>
    {(loading || error || requests.length === 0) ? state : <section className="panel table-panel"><table><thead><tr>
      {isAdmin && <th>Employee</th>}<th>Leave type</th><th>Dates</th><th>Days</th><th>Status</th>
    </tr></thead><tbody>
      {requests.map(request => <tr key={request.id} onClick={() => setSelected(request)}>
        {isAdmin && <td><b>{request.employee.firstName} {request.employee.lastName}</b><small className="subline">{request.employee.employeeNumber}</small></td>}
        <td>{request.leaveType.name}</td>
        <td>{formatDate(request.startDate)}{request.startDate !== request.endDate ? ` – ${formatDate(request.endDate)}` : ''}{request.halfDay ? ' (half day)' : ''}</td>
        <td>{request.totalDays}</td>
        <td><Badge tone={STATUS_TONE[request.status]}>{label(request.status)}</Badge></td>
      </tr>)}
    </tbody></table></section>}

    {selected && <div className="detail-panel">
      <div className="detail-head"><div><small>LEAVE REQUEST</small><h2>{selected.leaveType.name}</h2><p>{selected.employee.firstName} {selected.employee.lastName} · {formatDate(selected.startDate)}{selected.startDate !== selected.endDate ? ` – ${formatDate(selected.endDate)}` : ''}</p></div><button className="icon-button" onClick={() => setSelected(undefined)}><X size={18}/></button></div>
      <div className="detail-status"><Badge tone={STATUS_TONE[selected.status]}>{label(selected.status)}</Badge><span>{selected.totalDays} day(s){selected.halfDay ? ' · half day' : ''}</span></div>
      {selected.reason && <p>{selected.reason}</p>}
      {selected.status === 'PENDING' && <button className="secondary full" onClick={() => void cancel(selected)}>Cancel request</button>}
    </div>}

    {form && <div className="detail-panel">
      <div className="detail-head"><div><small>RAISE LEAVE REQUEST</small><h2>New leave request</h2><p>Routes to your reporting manager for approval.</p></div><button className="icon-button" onClick={() => setForm(undefined)}><X size={18}/></button></div>
      {formError && <p className="form-error">{formError}</p>}
      <label>Leave type<select value={form.leaveTypeId} onChange={event => setForm({ ...form, leaveTypeId: event.target.value })}>
        <option value="">Select…</option>
        {leaveTypes.map(type => <option key={type.id} value={type.id}>{type.name}{type.paid ? '' : ' (unpaid)'}</option>)}
      </select></label>
      <div className="form-grid">
        <label>Start date<input type="date" value={form.startDate} onChange={event => setForm({ ...form, startDate: event.target.value })}/></label>
        <label>End date<input type="date" value={form.endDate} onChange={event => setForm({ ...form, endDate: event.target.value })}/></label>
      </div>
      <label><input type="checkbox" checked={form.halfDay} onChange={event => setForm({ ...form, halfDay: event.target.checked })} style={{ width: 'auto' }}/> Half day (start date only)</label>
      <label>Reason<textarea value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} placeholder="Add context for your manager"/></label>
      <button className="primary full" disabled={saving} onClick={() => void submit()}>{saving ? <><LoaderCircle className="spinner" size={16}/> Submitting</> : 'Submit request'}</button>
    </div>}
  </>
}

const ON_DUTY_STATUS_TONE: Record<OnDutyRequestStatus, string> = {
  PENDING: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
  CANCELLED: 'neutral',
}

interface OnDutySubmitForm {
  category: OnDutyCategory
  startDate: string
  endDate: string
  halfDay: boolean
  location: string
  reason: string
}

function OnDutyRequestsPanel({ api, isAdmin, notify }: { api: ApiClient; isAdmin: boolean; notify: Notify }) {
  const [requests, setRequests] = useState<OnDutyRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<OnDutyRequestStatus | ''>('')
  const [form, setForm] = useState<OnDutySubmitForm>()
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<OnDutyRequest>()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await api.getOnDutyRequests({ status: statusFilter || undefined, pageSize: 100 })
      setRequests(result.items)
    } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api, statusFilter])
  useEffect(() => { void load() }, [load])

  const openSubmit = () => setForm({
    category: 'CLIENT_VISIT',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    halfDay: false,
    location: '',
    reason: '',
  })

  const submit = async () => {
    if (!form) return
    setFormError('')
    if (!form.reason.trim()) { setFormError('Enter a reason.'); return }
    setSaving(true)
    try {
      await api.submitOnDutyRequest({
        category: form.category,
        startDate: form.startDate,
        endDate: form.endDate,
        halfDay: form.halfDay,
        location: form.location.trim() || undefined,
        reason: form.reason.trim(),
      })
      notify('On-duty request submitted for approval.')
      setForm(undefined)
      await load()
    } catch (caught) { setFormError(errorMessage(caught)) } finally { setSaving(false) }
  }

  const cancel = async (request: OnDutyRequest) => {
    const approval = request.approvalRequests[0]
    if (!approval) { notify('No linked approval was found for this request.', 'warning'); return }
    try {
      await api.actOnApproval(approval.id, {
        action: 'CANCELLED', version: approval.version, comment: 'Cancelled by requester',
      })
      notify('On-duty request cancelled.')
      setSelected(undefined)
      await load()
    } catch (caught) { notify(errorMessage(caught), 'warning') }
  }

  const state = <LoadState loading={loading} error={error} empty={requests.length === 0} retry={() => void load()}/>

  return <>
    <div className="page-top">
      <p>{isAdmin ? 'All on-duty requests across the organization.' : 'Your on-duty requests. Approval routes to your reporting manager.'}</p>
      <button className="primary" onClick={openSubmit}><Plus size={16}/> Raise on-duty request</button>
    </div>
    <div className="filter-bar">
      <select aria-label="Status" value={statusFilter} onChange={event => setStatusFilter(event.target.value as OnDutyRequestStatus | '')}>
        <option value="">All statuses</option>
        <option value="PENDING">Pending</option>
        <option value="APPROVED">Approved</option>
        <option value="REJECTED">Rejected</option>
        <option value="CANCELLED">Cancelled</option>
      </select>
    </div>
    {(loading || error || requests.length === 0) ? state : <section className="panel table-panel"><table><thead><tr>
      {isAdmin && <th>Employee</th>}<th>Category</th><th>Dates</th><th>Days</th><th>Status</th>
    </tr></thead><tbody>
      {requests.map(request => <tr key={request.id} onClick={() => setSelected(request)}>
        {isAdmin && <td><b>{request.employee.firstName} {request.employee.lastName}</b><small className="subline">{request.employee.employeeNumber}</small></td>}
        <td>{label(request.category)}</td>
        <td>{formatDate(request.startDate)}{request.startDate !== request.endDate ? ` – ${formatDate(request.endDate)}` : ''}{request.halfDay ? ' (half day)' : ''}</td>
        <td>{request.totalDays}</td>
        <td><Badge tone={ON_DUTY_STATUS_TONE[request.status]}>{label(request.status)}</Badge></td>
      </tr>)}
    </tbody></table></section>}

    {selected && <div className="detail-panel">
      <div className="detail-head"><div><small>ON-DUTY REQUEST</small><h2>{label(selected.category)}</h2><p>{selected.employee.firstName} {selected.employee.lastName} · {formatDate(selected.startDate)}{selected.startDate !== selected.endDate ? ` – ${formatDate(selected.endDate)}` : ''}</p></div><button className="icon-button" onClick={() => setSelected(undefined)}><X size={18}/></button></div>
      <div className="detail-status"><Badge tone={ON_DUTY_STATUS_TONE[selected.status]}>{label(selected.status)}</Badge><span>{selected.totalDays} day(s){selected.halfDay ? ' · half day' : ''}</span></div>
      {selected.location && <p><b>Location:</b> {selected.location}</p>}
      <p>{selected.reason}</p>
      {selected.status === 'PENDING' && <button className="secondary full" onClick={() => void cancel(selected)}>Cancel request</button>}
    </div>}

    {form && <div className="detail-panel">
      <div className="detail-head"><div><small>RAISE ON-DUTY REQUEST</small><h2>New on-duty request</h2><p>Routes to your reporting manager for approval.</p></div><button className="icon-button" onClick={() => setForm(undefined)}><X size={18}/></button></div>
      {formError && <p className="form-error">{formError}</p>}
      <label>Category<select value={form.category} onChange={event => setForm({ ...form, category: event.target.value as OnDutyCategory })}>
        {ON_DUTY_CATEGORIES.map(category => <option key={category} value={category}>{label(category)}</option>)}
      </select></label>
      <div className="form-grid">
        <label>Start date<input type="date" value={form.startDate} onChange={event => setForm({ ...form, startDate: event.target.value })}/></label>
        <label>End date<input type="date" value={form.endDate} onChange={event => setForm({ ...form, endDate: event.target.value })}/></label>
        <label>Location (optional)<input value={form.location} onChange={event => setForm({ ...form, location: event.target.value })} placeholder="e.g. Client office, Bengaluru"/></label>
      </div>
      <label><input type="checkbox" checked={form.halfDay} onChange={event => setForm({ ...form, halfDay: event.target.checked })} style={{ width: 'auto' }}/> Half day (start date only)</label>
      <label>Reason<textarea value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} placeholder="Add context for your manager"/></label>
      <button className="primary full" disabled={saving} onClick={() => void submit()}>{saving ? <><LoaderCircle className="spinner" size={16}/> Submitting</> : 'Submit request'}</button>
    </div>}
  </>
}

interface TypeForm {
  mode: 'create' | 'edit'
  type?: LeaveType
  name: string
  code: string
  paid: boolean
  defaultAnnualDays: string
  active: boolean
}

function LeaveTypesPanel({ api, onChanged, notify }: { api: ApiClient; onChanged: () => Promise<void>; notify: Notify }) {
  const [types, setTypes] = useState<LeaveType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState<TypeForm>()
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setTypes(await api.getLeaveTypes(true)) } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api])
  useEffect(() => { void load() }, [load])

  const openCreate = () => setForm({ mode: 'create', name: '', code: '', paid: true, defaultAnnualDays: '', active: true })
  const openEdit = (type: LeaveType) => setForm({
    mode: 'edit', type, name: type.name, code: type.code, paid: type.paid,
    defaultAnnualDays: type.defaultAnnualDays ?? '', active: type.active,
  })

  const submit = async () => {
    if (!form) return
    setFormError('')
    if (!form.name.trim()) { setFormError('Enter a name.'); return }
    if (form.mode === 'create' && !form.code.trim()) { setFormError('Enter a code.'); return }
    setSaving(true)
    try {
      const shared = {
        name: form.name.trim(),
        paid: form.paid,
        defaultAnnualDays: form.defaultAnnualDays ? Number(form.defaultAnnualDays) : undefined,
      }
      if (form.mode === 'create') {
        await api.createLeaveType({ ...shared, code: form.code.trim() })
        notify('Leave type created.')
      } else if (form.type) {
        await api.updateLeaveType(form.type.id, { ...shared, active: form.active })
        notify('Leave type updated.')
      }
      setForm(undefined)
      await load()
      await onChanged()
    } catch (caught) { setFormError(errorMessage(caught)) } finally { setSaving(false) }
  }

  const state = <LoadState loading={loading} error={error} empty={types.length === 0} retry={() => void load()}/>

  return <>
    <div className="page-top"><p>Leave types available for requests, with an optional default annual allocation.</p><button className="secondary" onClick={openCreate}><Plus size={16}/> Add leave type</button></div>
    {(loading || error || types.length === 0) ? state : <section className="panel table-panel"><table><thead><tr><th>Name</th><th>Code</th><th>Paid</th><th>Default days/year</th><th>Status</th><th></th></tr></thead><tbody>
      {types.map(type => <tr key={type.id}>
        <td><b>{type.name}</b></td>
        <td>{type.code}</td>
        <td>{type.paid ? 'Paid' : 'Unpaid'}</td>
        <td>{type.defaultAnnualDays ?? '—'}</td>
        <td><Badge tone={type.active ? 'green' : 'neutral'}>{type.active ? 'Active' : 'Inactive'}</Badge></td>
        <td><button className="secondary small" onClick={() => openEdit(type)}>Edit</button></td>
      </tr>)}
    </tbody></table></section>}

    {form && <div className="detail-panel">
      <div className="detail-head"><div><small>{form.mode === 'create' ? 'ADD LEAVE TYPE' : 'EDIT LEAVE TYPE'}</small><h2>{form.mode === 'create' ? 'New leave type' : form.type?.name}</h2></div><button className="icon-button" onClick={() => setForm(undefined)}><X size={18}/></button></div>
      {formError && <p className="form-error">{formError}</p>}
      <div className="form-grid">
        <label>Name<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="e.g. Casual Leave"/></label>
        <label>Code<input value={form.code} disabled={form.mode === 'edit'} onChange={event => setForm({ ...form, code: event.target.value })} placeholder="e.g. CL"/></label>
        <label>Default days/year (blank = none)<input type="number" min={0} max={365} step={0.5} value={form.defaultAnnualDays} onChange={event => setForm({ ...form, defaultAnnualDays: event.target.value })}/></label>
      </div>
      <label><input type="checkbox" checked={form.paid} onChange={event => setForm({ ...form, paid: event.target.checked })} style={{ width: 'auto' }}/> Paid (balance is enforced on request)</label>
      {form.mode === 'edit' && <label><input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} style={{ width: 'auto' }}/> Active (visible for new requests)</label>}
      <button className="primary full" disabled={saving} onClick={() => void submit()}>{saving ? <><LoaderCircle className="spinner" size={16}/> Saving</> : form.mode === 'create' ? 'Add leave type' : 'Save leave type'}</button>
    </div>}
  </>
}

function BalancesPanel({ api, leaveTypes, notify }: { api: ApiClient; leaveTypes: LeaveType[]; notify: Notify }) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [grantForm, setGrantForm] = useState<{ leaveTypeId: string; allocatedDays: string }>()
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.getEmployees().then(setEmployees).catch(() => {
      // The employee picker degrades to empty; the rest of the panel still works once
      // an id is otherwise available.
    })
  }, [api])

  const load = useCallback(async () => {
    if (!employeeId) { setBalances([]); return }
    setLoading(true); setError('')
    try { setBalances(await api.getLeaveBalances({ employeeId })) } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api, employeeId])
  useEffect(() => { void load() }, [load])

  const grant = async () => {
    if (!grantForm || !employeeId) return
    setFormError('')
    if (!grantForm.leaveTypeId) { setFormError('Choose a leave type.'); return }
    const allocatedDays = Number(grantForm.allocatedDays)
    if (!Number.isFinite(allocatedDays) || allocatedDays < 0) { setFormError('Enter a valid number of days.'); return }
    setSaving(true)
    try {
      await api.setLeaveBalance({
        employeeId, leaveTypeId: grantForm.leaveTypeId, year: new Date().getFullYear(), allocatedDays,
      })
      notify('Balance updated.')
      setGrantForm(undefined)
      await load()
    } catch (caught) { setFormError(errorMessage(caught)) } finally { setSaving(false) }
  }

  const selectedEmployee = employees.find(employee => employee.id === employeeId)

  return <>
    <div className="page-top"><p>Grant or adjust an employee's leave balance for the current year.</p></div>
    <div className="filter-bar">
      <select aria-label="Employee" value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
        <option value="">Select an employee…</option>
        {employees.map(employee => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} ({employee.employeeNumber})</option>)}
      </select>
      {employeeId && <button className="secondary small" onClick={() => setGrantForm({ leaveTypeId: '', allocatedDays: '' })}><Plus size={16}/> Grant balance</button>}
    </div>
    {!employeeId
      ? <div className="empty-panel panel"><Sparkles size={25}/><h2>Select an employee to view balances</h2></div>
      : (loading || error || balances.length === 0)
        ? <LoadState loading={loading} error={error} empty={balances.length === 0} retry={() => void load()}/>
        : <section className="panel table-panel"><table><thead><tr><th>Leave type</th><th>Year</th><th>Allocated</th><th>Used</th><th>Available</th></tr></thead><tbody>
            {balances.map(balance => <tr key={balance.id}>
              <td><b>{balance.leaveType.name}</b></td>
              <td>{balance.year}</td>
              <td>{balance.allocatedDays}</td>
              <td>{balance.usedDays}</td>
              <td>{(Number(balance.allocatedDays) - Number(balance.usedDays)).toFixed(2)}</td>
            </tr>)}
          </tbody></table></section>}

    {grantForm && <div className="detail-panel">
      <div className="detail-head"><div><small>GRANT BALANCE</small><h2>{selectedEmployee ? `${selectedEmployee.firstName} ${selectedEmployee.lastName}` : 'Employee'}</h2><p>{new Date().getFullYear()}</p></div><button className="icon-button" onClick={() => setGrantForm(undefined)}><X size={18}/></button></div>
      {formError && <p className="form-error">{formError}</p>}
      <label>Leave type<select value={grantForm.leaveTypeId} onChange={event => {
        const type = leaveTypes.find(candidate => candidate.id === event.target.value)
        setGrantForm({ leaveTypeId: event.target.value, allocatedDays: type?.defaultAnnualDays ?? grantForm.allocatedDays })
      }}>
        <option value="">Select…</option>
        {leaveTypes.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
      </select></label>
      <label>Allocated days<input type="number" min={0} max={365} step={0.5} value={grantForm.allocatedDays} onChange={event => setGrantForm({ ...grantForm, allocatedDays: event.target.value })}/></label>
      <button className="primary full" disabled={saving} onClick={() => void grant()}>{saving ? <><LoaderCircle className="spinner" size={16}/> Saving</> : 'Save balance'}</button>
    </div>}
  </>
}
