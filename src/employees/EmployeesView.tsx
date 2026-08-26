import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, LoaderCircle, Pencil, Plus, RefreshCw, Users, X } from 'lucide-react'
import {
  ApiError,
  createApiClient,
  type Employee,
  type EmployeeInput,
  type EmployeeStatus,
} from '../lib/api'

interface EmployeesViewProps {
  getAccessToken: () => Promise<string>
  tenantId: string
}

const emptyInput: EmployeeInput = {
  employeeNumber: '',
  firstName: '',
  lastName: '',
  email: '',
  status: 'ACTIVE',
  hireDate: '',
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) return 'Your tenant role does not allow this action.'
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

export function EmployeesView({ getAccessToken, tenantId }: EmployeesViewProps) {
  const api = useMemo(() => createApiClient({ getAccessToken, tenantId }), [getAccessToken, tenantId])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Employee | 'new' | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      setEmployees(await api.getEmployees(signal))
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(errorMessage(caught))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [api])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const saved = (employee: Employee) => {
    setEmployees(current => {
      const exists = current.some(item => item.id === employee.id)
      const next = exists ? current.map(item => item.id === employee.id ? employee : item) : [...current, employee]
      return next.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
    })
    setEditing(null)
  }

  return <><div className="page-top"><p>Manage employees stored in the selected tenant’s PostgreSQL database.</p><button className="primary" onClick={() => setEditing('new')}><Plus size={16}/> Add employee</button></div>
    {error && <div className="state-banner error" role="alert"><AlertTriangle size={18}/><div><b>Employees could not be loaded</b><p>{error}</p></div><button className="secondary small" onClick={() => void load()}><RefreshCw size={14}/> Retry</button></div>}
    {loading ? <section className="panel empty-state"><LoaderCircle className="spinner" size={30}/><h2>Loading employees</h2><p>Retrieving tenant employee records…</p></section>
      : !error && employees.length === 0 ? <section className="panel empty-state"><Users size={32}/><h2>No employees yet</h2><p>Add the first employee for this tenant to get started.</p><button className="primary" onClick={() => setEditing('new')}><Plus size={16}/> Add employee</button></section>
      : !error && <section className="panel table-panel employee-table"><table><thead><tr><th>Employee</th><th>Employee number</th><th>Email</th><th>Hire date</th><th>Status</th><th></th></tr></thead><tbody>{employees.map(employee => <tr key={employee.id}><td><b>{employee.firstName} {employee.lastName}</b></td><td>{employee.employeeNumber}</td><td>{employee.email || <span className="muted">Not provided</span>}</td><td>{employee.hireDate ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(employee.hireDate)) : <span className="muted">Not provided</span>}</td><td><span className={`badge ${employee.status === 'ACTIVE' ? 'green' : employee.status === 'INACTIVE' ? 'amber' : 'red'}`}>{employee.status.toLowerCase()}</span></td><td><button className="secondary small" onClick={() => setEditing(employee)}><Pencil size={13}/> Edit</button></td></tr>)}</tbody></table></section>}
    {editing && <EmployeeForm employee={editing === 'new' ? null : editing} api={api} onClose={() => setEditing(null)} onSaved={saved}/>}
  </>
}

interface EmployeeFormProps {
  employee: Employee | null
  api: ReturnType<typeof createApiClient>
  onClose: () => void
  onSaved: (employee: Employee) => void
}

function EmployeeForm({ employee, api, onClose, onSaved }: EmployeeFormProps) {
  const [input, setInput] = useState<EmployeeInput>(employee ? {
    employeeNumber: employee.employeeNumber,
    firstName: employee.firstName,
    lastName: employee.lastName,
    email: employee.email ?? '',
    status: employee.status,
    hireDate: employee.hireDate?.slice(0, 10) ?? '',
  } : emptyInput)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const update = (field: keyof EmployeeInput, value: string) => {
    setInput(current => ({ ...current, [field]: value }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const payload: EmployeeInput = {
      employeeNumber: input.employeeNumber.trim(),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      status: input.status,
      ...(input.email?.trim() ? { email: input.email.trim() } : {}),
      ...(input.hireDate ? { hireDate: input.hireDate } : {}),
    }
    if (!payload.employeeNumber || !payload.firstName || !payload.lastName) {
      setError('Employee number, first name, and last name are required.')
      return
    }
    setSaving(true)
    try {
      onSaved(employee ? await api.updateEmployee(employee.id, payload) : await api.createEmployee(payload))
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  return <div className="overlay form-overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className="employee-form panel" role="dialog" aria-modal="true" aria-labelledby="employee-form-title"><div className="panel-head"><div><h2 id="employee-form-title">{employee ? 'Edit employee' : 'Add employee'}</h2><p>Organizational assignments can be added in a later milestone.</p></div><button className="icon-button" type="button" aria-label="Close" onClick={onClose}><X size={18}/></button></div><form onSubmit={submit}><div className="form-grid"><label>Employee number<input required maxLength={50} value={input.employeeNumber} onChange={event => update('employeeNumber', event.target.value)}/></label><label>Status<select value={input.status} onChange={event => update('status', event.target.value as EmployeeStatus)}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="TERMINATED">Terminated</option></select></label><label>First name<input required maxLength={100} value={input.firstName} onChange={event => update('firstName', event.target.value)}/></label><label>Last name<input required maxLength={100} value={input.lastName} onChange={event => update('lastName', event.target.value)}/></label><label>Email (optional)<input type="email" value={input.email} onChange={event => update('email', event.target.value)}/></label><label>Hire date (optional)<input type="date" value={input.hireDate} onChange={event => update('hireDate', event.target.value)}/></label></div>{error && <div className="form-error" role="alert">{error}</div>}<div className="wizard-actions"><button className="secondary" type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving ? <><LoaderCircle className="spinner" size={15}/> Saving…</> : employee ? 'Save changes' : 'Add employee'}</button></div></form></section></div>
}
