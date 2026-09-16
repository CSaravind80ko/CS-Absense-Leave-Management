import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, LoaderCircle, Sparkles } from 'lucide-react'
import {
  ApiError,
  type ApiClient,
  type AttendanceDepartmentSummary,
  type ExceptionTrendPeriod,
  type LeaveUtilizationRow,
  type ProcessingPeriod,
} from '../lib/api'

const label = (value: string) => value.replaceAll('_', ' ').toLowerCase()
const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Something went wrong.'

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

function LoadState({ loading, error, empty, retry }: { loading: boolean; error: string; empty: boolean; retry: () => void }) {
  if (loading) return <div className="empty-panel panel"><LoaderCircle className="spinner" size={25}/><h2>Loading</h2></div>
  if (error) return <div className="empty-panel panel"><AlertTriangle size={25}/><h2>Something went wrong</h2><p className="form-error">{error}</p><button className="primary" onClick={retry}>Retry</button></div>
  if (empty) return <div className="empty-panel panel"><Sparkles size={25}/><h2>Nothing to show yet</h2></div>
  return null
}

export function ReportsView({ api }: { api: ApiClient }) {
  const [periods, setPeriods] = useState<ProcessingPeriod[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setPeriods((await api.getAttendancePeriods()).items) } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api])
  useEffect(() => { void load() }, [load])

  if (loading || error || periods.length === 0) {
    return <>
      <div className="page-top"><p>Cross-period analytics: department attendance, exception trends, and leave utilization.</p></div>
      <LoadState loading={loading} error={error} empty={periods.length === 0} retry={() => void load()}/>
    </>
  }

  return <>
    <div className="page-top"><p>Cross-period analytics: department attendance, exception trends, and leave utilization.</p></div>
    <AttendanceSummarySection api={api} periods={periods}/>
    <ExceptionTrendsSection api={api} periods={periods}/>
    <LeaveUtilizationSection api={api}/>
  </>
}

function AttendanceSummarySection({ api, periods }: { api: ApiClient; periods: ProcessingPeriod[] }) {
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? '')
  const [rows, setRows] = useState<AttendanceDepartmentSummary[]>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!periodId) return
    setLoading(true); setError('')
    try { setRows(await api.getAttendanceSummaryReport(periodId)) } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api, periodId])
  useEffect(() => { void load() }, [load])

  const state = <LoadState loading={loading} error={error} empty={!rows?.length} retry={() => void load()}/>
  return <section className="panel table-panel">
    <div className="panel-head"><div><h2>Attendance summary by department</h2><p>Daily status counts for the selected period.</p></div>
      <select aria-label="Period" value={periodId} onChange={event => setPeriodId(event.target.value)}>{periods.map(period => <option key={period.id} value={period.id}>{period.name}</option>)}</select>
    </div>
    {(loading || error || !rows?.length) ? state : <table><thead><tr><th>Department</th><th>Employees</th><th>Present</th><th>Absent</th><th>Partial</th><th>Leave</th><th>Holiday</th><th>Weekend</th><th>On-duty</th><th>Open exceptions</th></tr></thead><tbody>{rows.map(row => <tr key={row.departmentId ?? 'unassigned'}><td><b>{row.departmentName}</b></td><td>{row.employeeCount}</td><td>{row.present}</td><td>{row.absent}</td><td>{row.partial}</td><td>{row.leave}</td><td>{row.holiday}</td><td>{row.weekend}</td><td>{row.onDuty}</td><td>{row.openExceptions > 0 ? <Badge tone="red">{row.openExceptions}</Badge> : row.openExceptions}</td></tr>)}</tbody></table>}
  </section>
}

function ExceptionTrendsSection({ api, periods }: { api: ApiClient; periods: ProcessingPeriod[] }) {
  const recent = periods.slice(0, 6)
  const [selected, setSelected] = useState<string[]>(recent.map(period => period.id))
  const [rows, setRows] = useState<ExceptionTrendPeriod[]>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (selected.length === 0) { setRows([]); setLoading(false); return }
    setLoading(true); setError('')
    try { setRows(await api.getExceptionTrendsReport(selected)) } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api, selected])
  useEffect(() => { void load() }, [load])

  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])

  const state = <LoadState loading={loading} error={error} empty={!rows?.length} retry={() => void load()}/>
  return <section className="panel table-panel">
    <div className="panel-head"><div><h2>Exception trends</h2><p>Total exceptions raised per period, to spot recurring patterns.</p></div></div>
    <div className="filter-bar">{recent.map(period => <button key={period.id} className={selected.includes(period.id) ? 'selected' : ''} onClick={() => toggle(period.id)}>{period.name}</button>)}</div>
    {(loading || error || !rows?.length) ? state : <table><thead><tr><th>Period</th><th>Total</th><th>Critical</th><th>High</th><th>By type</th></tr></thead><tbody>{rows.map(row => <tr key={row.periodId}><td><b>{row.periodName}</b></td><td>{row.total}</td><td>{row.critical > 0 ? <Badge tone="red">{row.critical}</Badge> : row.critical}</td><td>{row.high > 0 ? <Badge tone="orange">{row.high}</Badge> : row.high}</td><td>{Object.entries(row.byType).map(([type, count]) => `${label(type)}: ${count}`).join(' · ') || '—'}</td></tr>)}</tbody></table>}
  </section>
}

function LeaveUtilizationSection({ api }: { api: ApiClient }) {
  const [year, setYear] = useState(new Date().getFullYear())
  const [rows, setRows] = useState<LeaveUtilizationRow[]>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setRows(await api.getLeaveUtilizationReport(year)) } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api, year])
  useEffect(() => { void load() }, [load])

  const state = <LoadState loading={loading} error={error} empty={!rows?.length} retry={() => void load()}/>
  return <section className="panel table-panel">
    <div className="panel-head"><div><h2>Leave &amp; comp-off utilization</h2><p>Allocated vs. used days per leave type for the selected year.</p></div>
      <input type="number" aria-label="Year" value={year} min="2000" max="2100" onChange={event => setYear(Number(event.target.value) || year)}/>
    </div>
    {(loading || error || !rows?.length) ? state : <table><thead><tr><th>Leave type</th><th>Employees</th><th>Allocated</th><th>Used</th><th>Remaining</th></tr></thead><tbody>{rows.map(row => <tr key={row.leaveTypeId}><td><b>{row.name}</b>{row.isCompOff && <small className="subline">Comp-off</small>}{!row.paid && <small className="subline">Unpaid</small>}</td><td>{row.employeeCount}</td><td>{row.allocatedDays}</td><td>{row.usedDays}</td><td>{row.remainingDays}</td></tr>)}</tbody></table>}
  </section>
}
