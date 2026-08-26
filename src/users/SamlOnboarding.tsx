import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  type SamlConnection,
  type SamlIdentityConnection,
  type createApiClient,
} from '../lib/api'

type ApiClient = ReturnType<typeof createApiClient>
type MetadataMode = 'url' | 'xml'

function statusTone(status: SamlConnection['status']) {
  if (status === 'ACTIVE' || status === 'READY') return 'green'
  if (status === 'ERROR') return 'red'
  if (status === 'DISABLED') return 'neutral'
  return 'amber'
}

function readableDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : 'Not available'
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'The SAML operation failed.'
}

export function SamlOnboarding({ api }: { api: ApiClient }) {
  const [connections, setConnections] = useState<SamlConnection[]>([])
  const [identityConnections, setIdentityConnections] = useState<SamlIdentityConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState('')
  const [editingMetadata, setEditingMetadata] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [saml, identity] = await Promise.all([
        api.getSamlConnections(),
        api.getSamlIdentityConnections(),
      ])
      setConnections(saml)
      setIdentityConnections(identity)
    } catch (caught) {
      setError(message(caught))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id)
    setError('')
    try {
      await action()
      await load()
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy('')
    }
  }

  const test = async (connection: SamlConnection) => {
    const testWindow = window.open('', '_blank')
    if (testWindow) {
      testWindow.opener = null
      testWindow.document.title = 'Preparing SAML test login'
      testWindow.document.body.textContent = 'Verifying Cognito configuration…'
    }
    setBusy(connection.id)
    setError('')
    try {
      const result = await api.testSamlConnection(connection.id)
      await load()
      if (testWindow) testWindow.location.replace(result.managedLoginUrl)
      else window.location.assign(result.managedLoginUrl)
    } catch (caught) {
      testWindow?.close()
      setError(message(caught))
    } finally {
      setBusy('')
    }
  }

  const activate = async (connection: SamlConnection) => {
    if (!window.confirm('Activate this SAML connection for tenant login discovery?')) return
    await run(connection.id, () => api.activateSamlConnection(connection.id))
  }

  return <section className="saml-section" aria-labelledby="saml-onboarding-title">
    <div className="page-top saml-heading">
      <div>
        <h2 id="saml-onboarding-title">Enterprise SAML</h2>
        <p>Federate Entra ID, Okta, or another SAML 2.0 provider through Cognito Managed Login.</p>
      </div>
      <button className="secondary" onClick={() => setCreating(true)} disabled={identityConnections.length === 0}>
        <Plus size={15}/> Add SAML connection
      </button>
    </div>
    {error && <div className="state-banner error" role="alert"><AlertTriangle size={18}/><div><b>SAML onboarding action failed</b><p>{error}</p></div><button className="secondary small" onClick={() => void load()}><RefreshCw size={14}/> Retry</button></div>}
    {loading ? <div className="panel saml-loading"><LoaderCircle className="spinner" size={24}/> Loading SAML configuration…</div>
      : connections.length === 0 ? <div className="panel saml-empty"><LockKeyhole size={27}/><div><h3>No SAML connection configured</h3><p>A pre-provisioned, allowlisted Cognito connection is required before onboarding.</p></div></div>
        : <div className="saml-grid">{connections.map(connection =>
          <SamlConnectionCard
            key={connection.id}
            connection={connection}
            busy={busy === connection.id}
            onMetadata={() => setEditingMetadata(connection.id)}
            onProvision={() => run(connection.id, () => api.provisionSamlConnection(connection.id))}
            onTest={() => test(connection)}
            onActivate={() => activate(connection)}
            onDisable={() => run(connection.id, () => api.disableSamlConnection(connection.id))}
          />,
        )}</div>}
    {creating && <CreateSamlDialog api={api} identityConnections={identityConnections} onClose={() => setCreating(false)} onCreated={async (connection) => { setCreating(false); setEditingMetadata(connection.id); await load() }}/>}
    {editingMetadata && <MetadataDialog api={api} id={editingMetadata} onClose={() => setEditingMetadata(null)} onSaved={async () => { setEditingMetadata(null); await load() }}/>}
  </section>
}

function SamlConnectionCard({
  connection,
  busy,
  onMetadata,
  onProvision,
  onTest,
  onActivate,
  onDisable,
}: {
  connection: SamlConnection
  busy: boolean
  onMetadata: () => void
  onProvision: () => Promise<void>
  onTest: () => Promise<void>
  onActivate: () => Promise<void>
  onDisable: () => Promise<void>
}) {
  const canEdit = ['DRAFT', 'METADATA_VALID', 'ERROR', 'DISABLED'].includes(connection.status)
  return <article className={`panel saml-card ${connection.status === 'ERROR' ? 'has-error' : ''}`}>
    <div className="panel-head">
      <div><h3>{connection.cognitoProviderName}</h3><p>{connection.entityId ?? 'Metadata has not been validated'}</p></div>
      <span className={`badge ${statusTone(connection.status)}`}>{connection.status.replaceAll('_', ' ').toLowerCase()}</span>
    </div>
    {connection.lastErrorMessage && <div className="saml-error" role="status"><AlertTriangle size={15}/><span><b>{connection.lastErrorCode ?? 'Configuration error'}</b>{connection.lastErrorMessage}</span></div>}
    <dl className="saml-details">
      <div><dt>Metadata validated</dt><dd>{readableDate(connection.metadataValidatedAt)}</dd></div>
      <div><dt>Last tested</dt><dd>{readableDate(connection.testedAt)}</dd></div>
      <div><dt>Signing certificates</dt><dd>{connection.certificateFingerprints.length}</dd></div>
      <div><dt>Attributes</dt><dd>{Object.keys(connection.attributeMapping).join(', ') || 'email'}</dd></div>
    </dl>
    {connection.certificateDetails?.length ? <details className="certificate-list"><summary>Certificate details</summary>{connection.certificateDetails.map(certificate => <div key={certificate.fingerprintSha256}><code>{certificate.fingerprintSha256}</code><span>{certificate.subject ?? 'Subject unavailable'} · {certificate.validityState.replaceAll('_', ' ').toLowerCase()} · valid until {readableDate(certificate.validTo)}</span></div>)}</details> : null}
    {connection.testResult?.providerConfigured && connection.testResult.providerEnabled
      ? <div className="saml-test-ready"><CheckCircle2 size={16}/><span><b>Cognito configuration verified</b>{connection.testResult.message}</span></div>
      : connection.testResult
        ? <div className="saml-error" role="status"><AlertTriangle size={15}/><span><b>Cognito readiness check failed</b>{connection.testResult.message}</span></div>
        : null}
    <div className="saml-actions">
      {canEdit && <button className="secondary small" disabled={busy} onClick={onMetadata}><FileCode2 size={13}/> Metadata</button>}
      {['METADATA_VALID', 'ERROR', 'PROVISIONING'].includes(connection.status) && <button className="secondary small" disabled={busy} onClick={() => void onProvision()}>{busy ? <LoaderCircle className="spinner" size={13}/> : <Upload size={13}/>} {connection.status === 'PROVISIONING' ? 'Resume provisioning' : 'Provision'}</button>}
      {['READY', 'ACTIVE'].includes(connection.status) && <button className="secondary small" disabled={busy} onClick={() => void onTest()}><ExternalLink size={13}/> Test login</button>}
      {connection.status === 'READY' && connection.testedAt && <button className="primary small" disabled={busy} onClick={() => void onActivate()}><ShieldCheck size={13}/> Activate</button>}
      {connection.status === 'ACTIVE' && <button className="secondary small danger" disabled={busy} onClick={() => void onDisable()}>Disable</button>}
    </div>
  </article>
}

function CreateSamlDialog({
  api,
  identityConnections,
  onClose,
  onCreated,
}: {
  api: ApiClient
  identityConnections: SamlIdentityConnection[]
  onClose: () => void
  onCreated: (connection: SamlConnection) => Promise<void>
}) {
  const [identityConnectionId, setIdentityConnectionId] = useState(identityConnections[0]?.id ?? '')
  const [providerName, setProviderName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const created = await api.createSamlConnection({
        identityConnectionId,
        cognitoProviderName: providerName,
        attributeMapping: { email: 'email', given_name: 'given_name', family_name: 'family_name' },
      })
      await onCreated(created)
    } catch (caught) {
      setError(message(caught))
    } finally {
      setSaving(false)
    }
  }
  return <Dialog title="Add SAML connection" onClose={onClose}>
    <form onSubmit={submit}>
      <p className="muted">Select an existing Cognito connection. Dedicated pools must already be present in the deployment allowlist.</p>
      <div className="form-grid">
        <label>Cognito connection<select required value={identityConnectionId} onChange={event => setIdentityConnectionId(event.target.value)}>{identityConnections.map(connection => <option key={connection.id} value={connection.id}>{connection.discoverySlug ?? connection.cognitoUserPoolId} · {connection.type === 'DEDICATED_COGNITO' ? 'Dedicated' : 'Approved shared'}</option>)}</select></label>
        <label>Cognito provider name<input required pattern="[A-Za-z0-9_-]{1,32}" maxLength={32} placeholder="EnterpriseIdp" value={providerName} onChange={event => setProviderName(event.target.value)}/><small>1–32 letters, numbers, underscores, or hyphens.</small></label>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <DialogActions saving={saving} onClose={onClose} submitLabel="Create draft"/>
    </form>
  </Dialog>
}

function MetadataDialog({ api, id, onClose, onSaved }: { api: ApiClient; id: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [mode, setMode] = useState<MetadataMode>('url')
  const [metadataUrl, setMetadataUrl] = useState('')
  const [metadataXml, setMetadataXml] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 1024 * 1024) {
      setError('Metadata XML must be 1 MB or smaller.')
      return
    }
    setMetadataXml(await file.text())
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api.updateSamlMetadata(id, mode === 'url' ? { metadataUrl } : { metadataXml })
      await onSaved()
    } catch (caught) {
      setError(message(caught))
    } finally {
      setSaving(false)
    }
  }
  return <Dialog title="Validate identity provider metadata" onClose={onClose}>
    <form onSubmit={submit}>
      <div className="metadata-mode" role="radiogroup" aria-label="Metadata source">
        <label><input type="radio" name="metadata-mode" checked={mode === 'url'} onChange={() => setMode('url')}/> HTTPS metadata URL</label>
        <label><input type="radio" name="metadata-mode" checked={mode === 'xml'} onChange={() => setMode('xml')}/> XML upload or text</label>
      </div>
      {mode === 'url'
        ? <label>Metadata URL<input type="url" required placeholder="https://idp.example.com/metadata" value={metadataUrl} onChange={event => setMetadataUrl(event.target.value)}/><small>Private, loopback, link-local, and metadata-service addresses are blocked.</small></label>
        : <><label>Upload metadata XML<input type="file" accept=".xml,application/xml,text/xml" onChange={event => void upload(event)}/></label><label>Metadata XML<textarea required rows={10} value={metadataXml} onChange={event => setMetadataXml(event.target.value)} placeholder="<EntityDescriptor …>"/></label></>}
      <div className="rule-note"><ShieldCheck size={17}/><div><b>Strict validation</b><p>DTD and external entities are rejected. The entity ID, HTTPS SSO service, and currently valid signing certificate are required.</p></div></div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <DialogActions saving={saving} onClose={onClose} submitLabel="Validate and save"/>
    </form>
  </Dialog>
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="overlay form-overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className="employee-form panel saml-dialog" role="dialog" aria-modal="true" aria-labelledby="saml-dialog-title"><div className="panel-head"><div><h2 id="saml-dialog-title">{title}</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={onClose}>×</button></div>{children}</section></div>
}

function DialogActions({ saving, onClose, submitLabel }: { saving: boolean; onClose: () => void; submitLabel: string }) {
  return <div className="wizard-actions"><button className="secondary" type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving ? <><LoaderCircle className="spinner" size={15}/> Saving…</> : submitLabel}</button></div>
}
