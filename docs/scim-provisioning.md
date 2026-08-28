# SCIM 2.0 provisioning

This layer provisions tenant users and groups through the existing Cognito broker. It does not configure SAML identity providers, change Cognito app clients, verify SAML tokens, or alter SAML lifecycle state. SCIM is available only while both the linked `SamlConnection` and `IdentityConnection` are `ACTIVE`.

## Endpoint and authentication

The tenant and SAML-connection scoped base URL is:

```text
https://<application-host>/api/v1/scim/v2/<tenant-id>/<saml-connection-id>
```

Configure `SCIM_PUBLIC_BASE_URL` with the canonical prefix in production when requests can arrive through more than one public host. Tenant administrators enable SCIM and generate a bearer token from **User & Role Management → SCIM provisioning**. The token is shown once. The database stores only a per-token salted scrypt hash, a non-secret prefix, expiry, revocation, and last-used metadata.

SCIM bearer authentication is separate from interactive Cognito JWT authentication. A credential is scoped to one tenant and one active SAML/identity connection. Requests use `application/scim+json`, are limited to 256 KB by default, receive a correlation ID, and are rate-limited per credential.

## Supported protocol

| Resource | GET | Filtered list | POST | PUT | PATCH | DELETE |
| --- | --- | --- | --- | --- | --- | --- |
| ServiceProviderConfig | Yes | N/A | No | No | No | No |
| ResourceTypes | Collection and by ID | N/A | No | No | No | No |
| Schemas | Collection and by ID | N/A | No | No | No | No |
| Users | Yes | `userName eq`, `externalId eq`, `id eq` | Yes | Yes | Yes | Soft deprovision |
| Groups | Yes | `displayName eq`, `externalId eq`, `id eq` | Yes | Yes | Yes | Yes |

Lists use RFC 7644 `startIndex` and `count`, with a maximum page size of 200. Filters accept one allowlisted attribute, the `eq` operator, and a quoted string. Logical, presence, ordering, and nested filters are rejected with `invalidFilter`; input is never converted to raw SQL.

User PATCH supports `add`, `replace`, and `remove` for `active`, `externalId`, `name`, name subattributes, and `emails`. Group PATCH supports `displayName`, `externalId`, `members`, and filtered member removal such as:

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "remove", "path": "members[value eq \"<scim-user-id>\"]" }
  ]
}
```

PATCH operations are idempotent. A repeated operation that changes nothing does not increment the resource version. POST, PUT, and PATCH also accept `Idempotency-Key`; keys are connection scoped, expire after 24 hours, and cannot be reused with a different method, path, or payload.

## Identity and lifecycle behavior

- A SCIM user receives a stable UUID that is not derived from email, `externalId`, domain, SAML NameID, or custom claims.
- Cognito users are created with a stable administrative `providerUsername`. Cognito's returned `sub` is stored separately as immutable `providerSubject`.
- The service creates `TenantMembership` first, then an immutable `ExternalIdentity` mapping for the tenant, identity connection, verified Cognito `sub`, and membership.
- User updates never rewrite the external identity mapping. Email, name, `userName`, and provider `externalId` remain attributes.
- Deactivation and DELETE disable tenant access and, when tenant-safe, the Cognito user. The membership, external identity, and audit history remain.
- Shared-pool Cognito access is not disabled if the same immutable identity has another active tenant membership.
- Reprovisioning a soft-deleted SCIM resource reuses its stable mapping only while both identity and SAML connections remain active.
- Cognito mutations are compensated when database persistence fails. Failed compensation is surfaced for operator action rather than reported as success.

## Group role mappings

Provider group names are never interpreted as application role names. New users receive the configured safe default role. A tenant administrator may explicitly map a provisioned SCIM group to one application role.

`TENANT_ADMIN` is never a default role. It can be mapped only after the administrator enables the privileged-role policy and separately confirms the specific mapping. Removing memberships or mappings deterministically recalculates the effective role from the remaining confirmed mappings and safe default.

## Microsoft Entra ID setup

1. Complete and activate the tenant SAML connection.
2. Enable SCIM in User & Role Management and generate a 90-day credential.
3. In the Entra enterprise application, open **Provisioning**, choose **Automatic**, and paste the SCIM base URL into **Tenant URL**.
4. Paste the one-time bearer token into **Secret Token**, test the connection, and save.
5. Keep the standard user attributes for `userName`, `active`, `name`, `emails`, and `externalId`. Configure group provisioning with object IDs as `externalId`.
6. Assign only intended users and groups, start provisioning, then configure application role mappings in this application after groups appear.

Entra commonly probes with `userName eq` and `externalId eq`, uses one-based pagination, deactivates users with PATCH `active=false`, and updates group members through PATCH. These operations are supported.

## Okta setup

1. Complete and activate the tenant SAML connection.
2. Enable SCIM and generate a credential.
3. In the Okta application, configure SCIM 2.0 with the generated base URL and **HTTP Header** authentication.
4. Enable create, update attributes, deactivate, and group push.
5. Use `userName` as the unique username attribute and retain Okta's immutable object identifier as `externalId`.
6. Push groups, then map each provider group to an application role from User & Role Management.

Okta user import, password synchronization, SCIM bulk, sorting, and password changes are not supported.

## Credential rotation and incident response

Rotate credentials before expiry and whenever operator access changes. Rotation atomically revokes every active credential for the connection before issuing a replacement. Update the provider immediately; the old token cannot be recovered or re-enabled.

For a suspected leak:

1. Rotate or revoke the credential in User & Role Management.
2. Review recent sanitized SCIM events and application logs using correlation IDs. Bearer tokens and request payloads are not logged.
3. Verify unexpected user activation, deactivation, and group membership changes.
4. Remove unsafe group-role mappings and disable SCIM if containment is required. Disabling SCIM revokes active credentials but retains resources and audit history.
5. Reissue a short-lived credential, update the provider, and re-enable only after the SAML and identity connections are confirmed active.

## Operational prerequisites

- Apply the `20260826170000_scim_provisioning` migration before deploying the API.
- Keep PostgreSQL storage encrypted and backed up; no additional plaintext secret store is introduced.
- The API task role requires only `AdminCreateUser`, `AdminGetUser`, `AdminDeleteUser`, `AdminDisableUser`, `AdminEnableUser`, `AdminUpdateUserAttributes`, and `AdminDeleteUserAttributes` on the shared pool and explicitly allowlisted dedicated pool ARNs.
- Set `SCIM_PUBLIC_BASE_URL`, `API_JSON_BODY_LIMIT`, and `SCIM_RATE_LIMIT_PER_MINUTE` for the environment. Put an edge/WAF rate limit in front of the API for distributed denial-of-service protection; the application also enforces per-process credential limits.
- Dedicated Cognito pool ARNs must remain in `IDENTITY_ADMIN_POOL_ARNS`. SCIM does not expand this allowlist.
- Retain sanitized audit events according to the organization's identity-governance policy and alert on repeated authentication failures, rate-limit responses, or compensation-required errors.
