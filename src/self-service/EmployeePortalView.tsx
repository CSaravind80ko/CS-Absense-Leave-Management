import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, CalendarDays, LoaderCircle, Sparkles } from 'lucide-react'
import {
  ApiError,
  type ApiClient,
  type CompOffCredit,
  type LeaveBalance,
  type LeaveRequest,
  type MyAttendanceSummary,
  type OnDutyRequest,
} from '../lib/api'

const label = (value: string) => value.replaceAll('_', ' ').toLowerCase()
const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Something went wrong.'
const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
const formatMinutes = (value: number) => `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, '0')}m`

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

function LoadState({ loading, error, empty, retry }: { loading: boolean; error: string; empty: boolean; retry: () => void }) {
  if (loading) return <div className="empty-panel panel"><LoaderCircle className="spinner" size={25}/><h2>Loading</h2></div>
  if (error) return <div className="empty-panel panel"><AlertTriangle size={25}/><h2>Something went wrong</h2><p className="form-error">{error}</p><button className="primary" onClick={retry}>Retry</button></div>
  if (empty) return <div className="empty-panel panel"><Sparkles size={25}/><h2>Nothing here yet</h2></div>
  return null
}

export function EmployeePortalView({ api, setView }: {
  api: ApiClient
  setView: (view: 'Leave & OD' | 'Comp-Off') => void
}) {
  const [summary, setSummary] = useState<MyAttendanceSummary>()
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [pendingLeave, setPendingLeave] = useState<LeaveRequest[]>([])
  const [pendingOnDuty, setPendingOnDuty] = useState<OnDutyRequest[]>([])
  const [pendingCompOff, setPendingCompOff] = useState<CompOffCredit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [summaryResult, balancesResult, leaveResult, onDutyResult, compOffResult] = await Promise.all([
        api.getMyAttendance(),
        api.getLeaveBalances(),
        api.getLeaveRequests({ status: 'PENDING', pageSize: 5 }),
        api.getOnDutyRequests({ status: 'PENDING', pageSize: 5 }),
        api.getCompOffCredits({ status: 'PENDING', pageSize: 5 }),
      ])
      setSummary(summaryResult)
      setBalances(balancesResult)
      setPendingLeave(leaveResult.items)
      setPendingOnDuty(onDutyResult.items)
      setPendingCompOff(compOffResult.items)
    } catch (caught) { setError(errorMessage(caught)) } finally { setLoading(false) }
  }, [api])
  useEffect(() => { void load() }, [load])

  if (loading || error) {
    return <>
      <div className="page-top"><p>Your attendance, leave balance, and pending requests.</p></div>
      <LoadState loading={loading} error={error} empty={false} retry={() => void load()}/>
    </>
  }

  const pendingCount = pendingLeave.length + pendingOnDuty.length + pendingCompOff.length
  const totals = summary?.totals

  return <>
    <div className="page-top">
      <p>Your attendance, leave balance, and pending requests{summary ? ` for ${summary.period.name}` : ''}.</p>
      <div><button className="secondary" onClick={() => setView('Comp-Off')}>Claim comp-off</button><button className="primary" onClick={() => setView('Leave & OD')}>Raise leave / OD</button></div>
    </div>
    <div className="balance-grid">
      {balances.map(balance => <div className="panel balance-card" key={balance.id}><b>{(Number(balance.allocatedDays) - Number(balance.usedDays)).toFixed(1)}</b><span>{balance.leaveType.name}</span><small>Available</small></div>)}
      {summary && summary.openExceptionCount > 0 && <div className="panel balance-card"><b className="critical-text">{summary.openExceptionCount}</b><span>Open exception{summary.openExceptionCount > 1 ? 's' : ''}</span><small>Under manager/HR review</small></div>}
    </div>
    <div className="two-panel">
      <section className="panel">
        <div className="panel-head"><div><h2>Pending requests</h2><p>Awaiting your reporting manager's decision</p></div><Badge tone={pendingCount ? 'amber' : 'green'}>{pendingCount} pending</Badge></div>
        {pendingCount === 0 ? <p className="muted">Nothing awaiting approval.</p> : <>
          {pendingLeave.map(request => <div className="self-item" key={request.id}><CalendarDays size={18}/><div><b>Leave · {request.leaveType.name}</b><p>{formatDate(request.startDate)}{request.startDate !== request.endDate ? ` – ${formatDate(request.endDate)}` : ''}{request.halfDay ? ' (half day)' : ''}</p></div><Badge tone="amber">Pending</Badge></div>)}
          {pendingOnDuty.map(request => <div className="self-item" key={request.id}><CalendarDays size={18}/><div><b>On-duty · {label(request.category)}</b><p>{formatDate(request.startDate)}{request.startDate !== request.endDate ? ` – ${formatDate(request.endDate)}` : ''}</p></div><Badge tone="amber">Pending</Badge></div>)}
          {pendingCompOff.map(request => <div className="self-item" key={request.id}><CalendarDays size={18}/><div><b>Comp-off claim</b><p>Worked {formatDate(request.workedDate)} · {request.creditDays} day(s)</p></div><Badge tone="amber">Pending</Badge></div>)}
        </>}
        <button className="text-button" onClick={() => setView('Leave & OD')}>View leave &amp; on-duty history <ArrowRight size={14}/></button>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>{summary?.period.name ?? 'Current period'} attendance</h2><p>Daily status breakdown</p></div></div>
        {totals && <div className="balance-grid">
          <div className="panel balance-card"><b>{totals.present}</b><span>Present</span></div>
          <div className="panel balance-card"><b className={totals.absent > 0 ? 'critical-text' : ''}>{totals.absent}</b><span>Absent</span></div>
          <div className="panel balance-card"><b>{totals.leave}</b><span>Leave</span></div>
          <div className="panel balance-card"><b>{totals.onDuty}</b><span>On-duty</span></div>
        </div>}
        {totals && <p className="muted">Worked {formatMinutes(totals.workedMinutes)} of {formatMinutes(totals.scheduledMinutes)} scheduled this period.</p>}
      </section>
    </div>
  </>
}
