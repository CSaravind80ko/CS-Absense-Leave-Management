import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, LoaderCircle, Plus, Sparkles, X } from 'lucide-react'
import {
  ApiError,
  type ApiClient,
  type Employee,
  type EmployeeGroup,
  type EmployeeGroupDetail,
  type Holiday,
  type OrgUnitOption,
  type PolicyPreview,
  type PolicyRules,
  type PolicyScopeType,
  type PolicyVersion,
  type PolicyVersionStatus,
} from '../lib/api'

type Notify = (message: string, kind?: 'success' | 'warning') => void

const label = (value: string) => value.replaceAll('_', ' ').toLowerCase()
const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Something went wrong.'
const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))

const WEEKDAYS: Array<[number, string]> = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']]

const DEFAULT_RULES: PolicyRules = {
  lateArrival: { graceMinutes: 10 },
  earlyDeparture: { graceMinutes: 10 },
  overtime: { thresholdMinutes: 30, dailyCapMinutes: null, roundingMinutes: 15 },
  halfDay: { halfDayThresholdMinutes: 240 },
  absence: { lop: true },
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

function LoadState({ loading, error, empty, retry }: { loading: boolean; error: string; empty: boolean; retry: () => void }) {
  if (loading) return <div className="empty-panel panel"><LoaderCircle className="spinner" size={25}/><h2>Loading</h2></div>
  if (error) return <div className="empty-panel panel"><AlertTriangle size={25}/><h2>Something went wrong</h2><p className="form-error">{error}</p><button className="primary" onClick={retry}>Retry</button></div>
  if (empty) return <div className="empty-panel panel"><Sparkles size={25}/><h2>Nothing here yet</h2></div>
  return null
}

interface DraftForm {
  mode: 'create' | 'edit'
  policy?: PolicyVersion
  scopeType: PolicyScopeType
  scopeId: string
  name: string
  effectiveFrom: string
  workingWeekdays: number[]
  rules: PolicyRules
}

export function PolicyConfigurationView({ api, notify }: { api: ApiClient; notify: Notify }) {
  const [tab, setTab] = useState<'policies' | 'groups' | 'holidays'>('policies')
  const [policies, setPolicies] = useState<PolicyVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [scopeTypeFilter, setScopeTypeFilter] = useState<PolicyScopeType | ''>('')
  const [statusFilter, setStatusFilter] = useState<PolicyVersionStatus | ''>('')

  const [departments, setDepartments] = useState<OrgUnitOption[]>([])
  const [locations, setLocations] = useState<OrgUnitOption[]>([])
  const [groups, setGroups] = useState<EmployeeGroup[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])

  const [draft, setDraft] = useState<DraftForm>()
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [previewFor, setPreviewFor] = useState<PolicyVersion>()
  const [preview, setPreview] = useState<PolicyPreview>()
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await api.getPolicies({
        scopeType: scopeTypeFilter || undefined,
        status: statusFilter || undefined,
      })
      setPolicies(result.items)
    } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api, scopeTypeFilter, statusFilter])
  useEffect(() => { void load() }, [load])

  const loadLookups = useCallback(async () => {
    try {
      const [dept, loc, grp, emp] = await Promise.all([
        api.getDepartments(), api.getLocations(), api.getEmployeeGroups(), api.getEmployees(),
      ])
      setDepartments(dept); setLocations(loc); setGroups(grp); setEmployees(emp)
    } catch {
      // Lookups are used for pickers/labels only; the core lists above already surface errors.
    }
  }, [api])
  useEffect(() => { void loadLookups() }, [loadLookups])

  const scopeLabel = (policy: PolicyVersion) => {
    if (policy.scopeType === 'TENANT') return 'Entire organization'
    if (policy.scopeType === 'DEPARTMENT') return departments.find(d => d.id === policy.scopeId)?.name ?? policy.scopeId.slice(0, 8)
    if (policy.scopeType === 'LOCATION') return locations.find(l => l.id === policy.scopeId)?.name ?? policy.scopeId.slice(0, 8)
    if (policy.scopeType === 'EMPLOYEE_GROUP') return groups.find(g => g.id === policy.scopeId)?.name ?? policy.scopeId.slice(0, 8)
    const employee = employees.find(e => e.id === policy.scopeId)
    return employee ? `${employee.firstName} ${employee.lastName}` : policy.scopeId.slice(0, 8)
  }

  const openCreate = () => setDraft({
    mode: 'create',
    scopeType: 'TENANT',
    scopeId: '',
    name: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    workingWeekdays: [1, 2, 3, 4, 5],
    rules: DEFAULT_RULES,
  })
  const openEdit = (policy: PolicyVersion) => setDraft({
    mode: 'edit',
    policy,
    scopeType: policy.scopeType,
    scopeId: policy.scopeType === 'TENANT' ? '' : policy.scopeId,
    name: policy.name,
    effectiveFrom: policy.effectiveFrom.slice(0, 10),
    workingWeekdays: policy.workingWeekdays,
    rules: policy.rules,
  })

  const submitDraft = async () => {
    if (!draft) return
    setFormError('')
    if (draft.scopeType !== 'TENANT' && !draft.scopeId) { setFormError('Choose a scope target.'); return }
    if (!draft.name.trim()) { setFormError('Enter a policy name.'); return }
    setSaving(true)
    try {
      if (draft.mode === 'create') {
        await api.createPolicyDraft({
          scopeType: draft.scopeType,
          scopeId: draft.scopeType === 'TENANT' ? undefined : draft.scopeId,
          name: draft.name.trim(),
          effectiveFrom: draft.effectiveFrom,
          workingWeekdays: draft.workingWeekdays,
          rules: draft.rules,
        })
        notify('Draft policy created.')
      } else if (draft.policy) {
        await api.updatePolicyDraft(draft.policy.id, {
          version: draft.policy.version,
          name: draft.name.trim(),
          effectiveFrom: draft.effectiveFrom,
          workingWeekdays: draft.workingWeekdays,
          rules: draft.rules,
        })
        notify('Draft policy updated.')
      }
      setDraft(undefined)
      await load()
    } catch (caught) { setFormError(errorMessage(caught)) } finally { setSaving(false) }
  }

  const removeDraft = async (policy: PolicyVersion) => {
    try {
      await api.deletePolicyDraft(policy.id)
      notify('Draft policy deleted.')
      await load()
    } catch (caught) { setError(errorMessage(caught)) }
  }

  const openPreview = async (policy: PolicyVersion) => {
    setPreviewFor(policy); setPreview(undefined); setPreviewError(''); setPreviewLoading(true)
    try { setPreview(await api.previewPolicyPublish(policy.id)) }
    catch (caught) { setPreviewError(errorMessage(caught)) }
    finally { setPreviewLoading(false) }
  }

  const confirmPublish = async () => {
    if (!previewFor) return
    try {
      await api.publishPolicy(previewFor.id, previewFor.version)
      notify(`Policy published; recompute scheduled for ${preview?.affectedAttendanceDayCount ?? 0} attendance days.`)
      setPreviewFor(undefined); setPreview(undefined)
      await load()
    } catch (caught) { setPreviewError(errorMessage(caught)) }
  }

  const toggleWeekday = (day: number) => {
    if (!draft) return
    const has = draft.workingWeekdays.includes(day)
    setDraft({ ...draft, workingWeekdays: has ? draft.workingWeekdays.filter(d => d !== day) : [...draft.workingWeekdays, day].sort() })
  }

  const scopeOptions = (scopeType: PolicyScopeType): OrgUnitOption[] => {
    if (scopeType === 'DEPARTMENT') return departments
    if (scopeType === 'LOCATION') return locations
    if (scopeType === 'EMPLOYEE_GROUP') return groups
    if (scopeType === 'EMPLOYEE') return employees.map(e => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, code: e.employeeNumber }))
    return []
  }

  return <>
    <div className="page-top">
      <p>No-code policy configuration with immutable version history and effective-date controls.</p>
      {tab === 'policies' && <button className="primary" onClick={openCreate}><Plus size={16}/> Create policy</button>}
    </div>
    <div className="tabs">
      <button className={tab === 'policies' ? 'selected' : ''} onClick={() => setTab('policies')}>Policies</button>
      <button className={tab === 'groups' ? 'selected' : ''} onClick={() => setTab('groups')}>Employee groups</button>
      <button className={tab === 'holidays' ? 'selected' : ''} onClick={() => setTab('holidays')}>Holidays</button>
    </div>

    {tab === 'policies' && <>
      <div className="filter-bar">
        <select aria-label="Scope type" value={scopeTypeFilter} onChange={event => setScopeTypeFilter(event.target.value as PolicyScopeType | '')}>
          <option value="">All scopes</option>
          <option value="TENANT">Tenant</option>
          <option value="LOCATION">Location</option>
          <option value="DEPARTMENT">Department</option>
          <option value="EMPLOYEE_GROUP">Employee group</option>
          <option value="EMPLOYEE">Employee</option>
        </select>
        <select aria-label="Status" value={statusFilter} onChange={event => setStatusFilter(event.target.value as PolicyVersionStatus | '')}>
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="PUBLISHED">Published</option>
        </select>
      </div>
      {(loading || error || policies.length === 0)
        ? <LoadState loading={loading} error={error} empty={policies.length === 0} retry={() => void load()}/>
        : <section className="panel table-panel"><table><thead><tr><th>Policy</th><th>Scope</th><th>Effective from</th><th>Version</th><th>Status</th><th></th></tr></thead><tbody>
            {policies.map(policy => <tr key={policy.id}>
              <td><b>{policy.name}</b></td>
              <td>{label(policy.scopeType)}<small className="subline">{scopeLabel(policy)}</small></td>
              <td>{formatDate(policy.effectiveFrom)}</td>
              <td>v{policy.version}</td>
              <td><Badge tone={policy.status === 'PUBLISHED' ? 'green' : 'amber'}>{label(policy.status)}</Badge></td>
              <td><div className="table-actions">
                {policy.status === 'DRAFT' && <button className="secondary small" onClick={() => openEdit(policy)}>Edit</button>}
                {policy.status === 'DRAFT' && <button className="secondary small" onClick={() => void openPreview(policy)}>Publish</button>}
                {policy.status === 'DRAFT' && <button className="secondary small" onClick={() => void removeDraft(policy)}>Delete</button>}
                {policy.status === 'PUBLISHED' && <button className="secondary small" onClick={() => { setScopeTypeFilter(policy.scopeType); }}>View scope history</button>}
              </div></td>
            </tr>)}
          </tbody></table></section>}
    </>}

    {tab === 'groups' && <EmployeeGroupsPanel api={api} groups={groups} employees={employees} onChanged={loadLookups} notify={notify}/>}

    {tab === 'holidays' && <HolidaysPanel api={api} locations={locations} notify={notify}/>}

    {draft && <div className="detail-panel">
      <div className="detail-head"><div><small>{draft.mode === 'create' ? 'CREATE POLICY' : 'EDIT DRAFT'}</small><h2>{draft.mode === 'create' ? 'New policy version' : draft.policy?.name}</h2><p>Changes are versioned; publishing supersedes the prior version for this scope.</p></div><button className="icon-button" onClick={() => setDraft(undefined)}><X size={18}/></button></div>
      {formError && <p className="form-error">{formError}</p>}
      <label>Name<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Corporate office attendance policy"/></label>
      <div className="form-grid">
        <label>Scope type<select value={draft.scopeType} disabled={draft.mode === 'edit'} onChange={event => setDraft({ ...draft, scopeType: event.target.value as PolicyScopeType, scopeId: '' })}>
          <option value="TENANT">Entire organization</option>
          <option value="LOCATION">Location</option>
          <option value="DEPARTMENT">Department</option>
          <option value="EMPLOYEE_GROUP">Employee group</option>
          <option value="EMPLOYEE">Employee</option>
        </select></label>
        {draft.scopeType !== 'TENANT' && <label>Scope target<select value={draft.scopeId} disabled={draft.mode === 'edit'} onChange={event => setDraft({ ...draft, scopeId: event.target.value })}>
          <option value="">Select…</option>
          {scopeOptions(draft.scopeType).map(option => <option key={option.id} value={option.id}>{option.name} ({option.code})</option>)}
        </select></label>}
        <label>Effective from<input type="date" value={draft.effectiveFrom} onChange={event => setDraft({ ...draft, effectiveFrom: event.target.value })}/></label>
      </div>
      <label>Working weekdays<div className="table-actions">{WEEKDAYS.map(([day, name]) => <button key={day} type="button" className={draft.workingWeekdays.includes(day) ? 'approve' : 'secondary small'} onClick={() => toggleWeekday(day)}>{name}</button>)}</div></label>
      <div className="form-grid">
        <label>Late arrival grace (minutes)<input type="number" min={0} max={240} value={draft.rules.lateArrival.graceMinutes} onChange={event => setDraft({ ...draft, rules: { ...draft.rules, lateArrival: { graceMinutes: Number(event.target.value) } } })}/></label>
        <label>Early departure grace (minutes)<input type="number" min={0} max={240} value={draft.rules.earlyDeparture.graceMinutes} onChange={event => setDraft({ ...draft, rules: { ...draft.rules, earlyDeparture: { graceMinutes: Number(event.target.value) } } })}/></label>
        <label>Overtime threshold (minutes)<input type="number" min={0} value={draft.rules.overtime.thresholdMinutes} onChange={event => setDraft({ ...draft, rules: { ...draft.rules, overtime: { ...draft.rules.overtime, thresholdMinutes: Number(event.target.value) } } })}/></label>
        <label>Overtime daily cap (minutes, blank = uncapped)<input type="number" min={1} value={draft.rules.overtime.dailyCapMinutes ?? ''} onChange={event => setDraft({ ...draft, rules: { ...draft.rules, overtime: { ...draft.rules.overtime, dailyCapMinutes: event.target.value ? Number(event.target.value) : null } } })}/></label>
        <label>Overtime rounding (minutes)<input type="number" min={1} value={draft.rules.overtime.roundingMinutes} onChange={event => setDraft({ ...draft, rules: { ...draft.rules, overtime: { ...draft.rules.overtime, roundingMinutes: Number(event.target.value) } } })}/></label>
        <label>Half-day threshold (minutes)<input type="number" min={0} value={draft.rules.halfDay.halfDayThresholdMinutes} onChange={event => setDraft({ ...draft, rules: { ...draft.rules, halfDay: { halfDayThresholdMinutes: Number(event.target.value) } } })}/></label>
      </div>
      <label><input type="checkbox" checked={draft.rules.absence.lop} onChange={event => setDraft({ ...draft, rules: { ...draft.rules, absence: { lop: event.target.checked } } })} style={{ width: 'auto' }}/> Absence exceptions carry payroll LOP impact</label>
      <button className="primary full" disabled={saving} onClick={() => void submitDraft()}>{saving ? <><LoaderCircle className="spinner" size={16}/> Saving</> : draft.mode === 'create' ? 'Create draft' : 'Save draft'}</button>
    </div>}

    {previewFor && <div className="detail-panel">
      <div className="detail-head"><div><small>PUBLISH IMPACT</small><h2>{previewFor.name}</h2><p>Review the impact before this version becomes effective.</p></div><button className="icon-button" onClick={() => { setPreviewFor(undefined); setPreview(undefined) }}><X size={18}/></button></div>
      {previewLoading && <LoadState loading empty={false} error="" retry={() => {}}/>}
      {previewError && <p className="form-error">{previewError}</p>}
      {preview && <>
        <div className="exception-summary"><div><b>{preview.affectedEmployeeCount}</b><span>Employees in scope</span></div><div><b>{preview.affectedAttendanceDayCount}</b><span>Days to recompute</span></div></div>
        <div className="rule-note compact"><Sparkles size={17}/><p>Recompute covers {formatDate(preview.dateFrom)} through {formatDate(preview.dateTo)}.</p></div>
        <h3>Rule changes</h3>
        {preview.ruleDiff.length === 0 ? <p>No prior published version for this scope — every rule is new.</p> : <div className="rule-trace-list">
          {preview.ruleDiff.map(change => <div className="rule-trace-row triggered" key={change.field}><AlertTriangle size={15}/><div><b>{change.field}</b><small>{String(change.from ?? '—')} <ArrowRight size={11}/> {String(change.to ?? '—')}</small></div></div>)}
        </div>}
        <button className="primary full" onClick={() => void confirmPublish()}>Confirm publish</button>
      </>}
    </div>}
  </>
}

function EmployeeGroupsPanel({ api, groups, employees, onChanged, notify }: {
  api: ApiClient; groups: EmployeeGroup[]; employees: Employee[]; onChanged: () => Promise<void>; notify: Notify
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [priority, setPriority] = useState(0)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<EmployeeGroupDetail>()
  const [addEmployeeId, setAddEmployeeId] = useState('')

  const openDetail = async (id: string) => {
    setSelectedId(id); setError('')
    try { setDetail(await api.getEmployeeGroup(id)) } catch (caught) { setError(errorMessage(caught)) }
  }

  const createGroup = async () => {
    if (!name.trim() || !code.trim()) { setError('Enter a name and code.'); return }
    try {
      await api.createEmployeeGroup({ name: name.trim(), code: code.trim(), priority })
      setName(''); setCode(''); setPriority(0); setCreating(false)
      notify('Employee group created.')
      await onChanged()
    } catch (caught) { setError(errorMessage(caught)) }
  }

  const addMember = async () => {
    if (!selectedId || !addEmployeeId) return
    try {
      await api.addGroupMember(selectedId, addEmployeeId)
      setAddEmployeeId('')
      await openDetail(selectedId)
      notify('Employee added to group; affected days queued for recompute.')
    } catch (caught) { setError(errorMessage(caught)) }
  }

  const removeMember = async (employeeId: string) => {
    if (!selectedId) return
    try {
      await api.removeGroupMember(selectedId, employeeId)
      await openDetail(selectedId)
      notify('Employee removed from group; affected days queued for recompute.')
    } catch (caught) { setError(errorMessage(caught)) }
  }

  const memberIds = new Set(detail?.members.map(member => member.employeeId))

  return <>
    <div className="page-top"><p>Groups break precedence ties by priority (higher wins) when an employee belongs to more than one.</p><button className="secondary" onClick={() => setCreating(true)}><Plus size={16}/> Create group</button></div>
    {error && <p className="form-error">{error}</p>}
    <section className="panel table-panel"><table><thead><tr><th>Group</th><th>Code</th><th>Priority</th><th></th></tr></thead><tbody>
      {groups.map(group => <tr key={group.id}><td><b>{group.name}</b></td><td>{group.code}</td><td>{group.priority}</td><td><button className="secondary small" onClick={() => void openDetail(group.id)}>Manage members</button></td></tr>)}
    </tbody></table></section>

    {creating && <div className="detail-panel">
      <div className="detail-head"><div><small>CREATE GROUP</small><h2>New employee group</h2></div><button className="icon-button" onClick={() => setCreating(false)}><X size={18}/></button></div>
      <label>Name<input value={name} onChange={event => setName(event.target.value)}/></label>
      <label>Code<input value={code} onChange={event => setCode(event.target.value)}/></label>
      <label>Priority (higher wins ties)<input type="number" min={0} max={1000} value={priority} onChange={event => setPriority(Number(event.target.value))}/></label>
      <button className="primary full" onClick={() => void createGroup()}>Create group</button>
    </div>}

    {detail && <div className="detail-panel">
      <div className="detail-head"><div><small>EMPLOYEE GROUP</small><h2>{detail.name}</h2><p>Priority {detail.priority} · {detail.members.length} members</p></div><button className="icon-button" onClick={() => setDetail(undefined)}><X size={18}/></button></div>
      <label>Add employee<div className="table-actions"><select value={addEmployeeId} onChange={event => setAddEmployeeId(event.target.value)}><option value="">Select…</option>{employees.filter(e => !memberIds.has(e.id)).map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName} ({e.employeeNumber})</option>)}</select><button className="secondary small" onClick={() => void addMember()}>Add</button></div></label>
      <div className="timeline-detail"><h3>Members</h3>
        {detail.members.length === 0 ? <p>No members yet.</p> : detail.members.map(member => <p key={member.employeeId}><i></i><b>{member.employee.firstName} {member.employee.lastName}</b><span>{member.employee.employeeNumber}</span><button className="icon-button" onClick={() => void removeMember(member.employeeId)}><X size={14}/></button></p>)}
      </div>
    </div>}
  </>
}

interface HolidayForm {
  mode: 'create' | 'edit'
  holiday?: Holiday
  name: string
  date: string
  locationId: string
}

function HolidaysPanel({ api, locations, notify }: { api: ApiClient; locations: OrgUnitOption[]; notify: Notify }) {
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState<HolidayForm>()
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setHolidays(await api.getHolidays()) } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api])
  useEffect(() => { void load() }, [load])

  const locationName = (id: string | null) =>
    id ? (locations.find(l => l.id === id)?.name ?? id.slice(0, 8)) : 'Entire organization'

  const openCreate = () => setForm({ mode: 'create', name: '', date: new Date().toISOString().slice(0, 10), locationId: '' })
  const openEdit = (holiday: Holiday) =>
    setForm({ mode: 'edit', holiday, name: holiday.name, date: holiday.date.slice(0, 10), locationId: holiday.locationId ?? '' })

  const submit = async () => {
    if (!form) return
    setFormError('')
    if (!form.name.trim()) { setFormError('Enter a holiday name.'); return }
    setSaving(true)
    try {
      const input = { name: form.name.trim(), date: form.date, locationId: form.locationId || undefined }
      if (form.mode === 'create') {
        await api.createHoliday(input)
        notify('Holiday added; the affected date is queued for recompute.')
      } else if (form.holiday) {
        await api.updateHoliday(form.holiday.id, input)
        notify('Holiday updated; affected dates are queued for recompute.')
      }
      setForm(undefined)
      await load()
    } catch (caught) { setFormError(errorMessage(caught)) } finally { setSaving(false) }
  }

  const remove = async (holiday: Holiday) => {
    try {
      await api.deleteHoliday(holiday.id)
      notify('Holiday deleted; the affected date is queued for recompute.')
      await load()
    } catch (caught) { setError(errorMessage(caught)) }
  }

  const state = <LoadState loading={loading} error={error} empty={holidays.length === 0} retry={() => void load()}/>

  return <>
    <div className="page-top">
      <p>Holidays mark a date as non-working for policy calculation. Adding, editing, or removing one queues an automatic recompute for the affected date.</p>
      <button className="secondary" onClick={openCreate}><Plus size={16}/> Add holiday</button>
    </div>
    {(loading || error || holidays.length === 0) ? state : <section className="panel table-panel"><table><thead><tr><th>Name</th><th>Date</th><th>Scope</th><th></th></tr></thead><tbody>
      {holidays.map(holiday => <tr key={holiday.id}>
        <td><b>{holiday.name}</b></td>
        <td>{formatDate(holiday.date)}</td>
        <td>{locationName(holiday.locationId)}</td>
        <td><div className="table-actions">
          <button className="secondary small" onClick={() => openEdit(holiday)}>Edit</button>
          <button className="secondary small" onClick={() => void remove(holiday)}>Delete</button>
        </div></td>
      </tr>)}
    </tbody></table></section>}

    {form && <div className="detail-panel">
      <div className="detail-head"><div><small>{form.mode === 'create' ? 'ADD HOLIDAY' : 'EDIT HOLIDAY'}</small><h2>{form.mode === 'create' ? 'New holiday' : form.holiday?.name}</h2></div><button className="icon-button" onClick={() => setForm(undefined)}><X size={18}/></button></div>
      {formError && <p className="form-error">{formError}</p>}
      <label>Name<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="e.g. Founders Day"/></label>
      <div className="form-grid">
        <label>Date<input type="date" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })}/></label>
        <label>Location (blank = entire organization)<select value={form.locationId} onChange={event => setForm({ ...form, locationId: event.target.value })}>
          <option value="">Entire organization</option>
          {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select></label>
      </div>
      <button className="primary full" disabled={saving} onClick={() => void submit()}>{saving ? <><LoaderCircle className="spinner" size={16}/> Saving</> : form.mode === 'create' ? 'Add holiday' : 'Save holiday'}</button>
    </div>}
  </>
}
