# Fair Garden Identification System

<!-- fg:version -->

Version **0.1.0-alpha.0**

<!-- /fg:version -->

<!-- fg:releasing -->

## Releasing

This module releases on its own. `0.1.0-alpha.0` is what main is working towards,
not what is published — the version here is always the next one.

1. **Publish it.** Run the *Publish* workflow from the Actions tab, picking the
   dist tag. It refuses if that version is already on npm.
2. **Move it on.** `pnpm release` — opens a pull request bumping this branch
   to `0.1.0-alpha.1`, or `pnpm release --id rc` to change
   identifier. A prerelease gets no maintenance branch; there is no released
   line behind it yet.

Every push to main publishes `@fairgarden/id@canary`. A canary is not a release and
carries no promise; it is there so main can be tried without a checkout.

<!-- /fg:releasing -->

An OpenID Connect provider for FairGarden services, built on
[oidc-provider](https://github.com/panva/node-oidc-provider). People sign in
with a passkey, or with a code or link sent to their email, and decide
service by service what each one can see.

It keeps only what is sensitive or has to be verified: email address, name,
phone number, mailing and residential addresses. Everything else about a
person belongs to the services; the members service is where a profile is
filled in, and it can hand its own claims to other services through this one
(see [Claims from other services](#claims-from-other-services)).

## Running it

```bash
pnpm dev            # http://localhost:3010
```

Run `apps/members` alongside (port 3020), or `pnpm dev` at the repository root
for everything, to sign in to a service.

Nothing else is needed locally. Without a database URL, an embedded Postgres
([PGlite](https://pglite.dev)) starts in `.data/id` and is migrated for you.
Without SMTP, email goes to the mock mailbox at
[/dev/mailbox](http://localhost:3010/dev/mailbox), and the sign-in link is
logged. `.env.development` enrols the members service; override anything in
`.env.development.local`.

## Documentation

The docs are a site in this repository, covering every piece in more depth
than this page:

```bash
pnpm --filter @fairgarden/id-docs dev   # http://localhost:3034
```

## Testing

```bash
pnpm test                               # unit tests (vitest)
pnpm exec playwright install chromium   # once
pnpm test:e2e                           # browser tests (Playwright)
pnpm policy:test                        # the Rego policies (needs the opa CLI)
```

Nothing outside this repository is needed. The browser tests build the
service for production and sign in to it from `e2e/mock-service.ts`, which is
both an ordinary OIDC client and a service supplying the `club` scope's
claims; passkeys use Chromium's virtual authenticator. `.github/workflows/test.yml`
runs all three.

## Configuration

Every variable is described in [.env.example](.env.example). The ones that
matter most:

| Variable | |
| --- | --- |
| `FG_ID_URL` | The public URL. The OIDC issuer, passkey domain and email links follow from it, so this is what white-labelling changes. |
| `FG_ID_NAME` | The name people see on every page, email and passkey prompt. |
| `FG_ID_DATABASE_URL` | Any Postgres. Neon's Vercel integration sets `DATABASE_URL`, which is used when this is not. |
| `FG_ID_SMTP_URL` | Where sign-in emails are sent from. |
| `FG_ID_SERVICE_<NAME>_*` | A service that signs in here. |

Inside a monolith the issuer is `FG_ID_URL` plus the mount point, such as
`https://example.com/id`.

## Services

Each service is a group of variables; the name becomes its client ID.

```bash
FG_ID_SERVICE_EVENTS_URL=https://events.example.com
FG_ID_SERVICE_EVENTS_SECRET=a-long-random-secret
```

Its redirect URI defaults to `<URL>/auth/callback` and its post-logout URI to
`<URL>`; `_REDIRECT_URIS`, `_LOGOUT_URIS`, `_NAME` and `_METADATA` (any other
client metadata, as JSON) change them. A service without a secret is a public
client. Every client must use PKCE.

## What people agree to share

The first time a service asks for something, the person sees each scope with
what it would share, and chooses. `openid` is always shared; `email` and
`profile` start ticked; `phone`, `address`, `residential_address` and anything
from another service start unticked, so sharing them is always a choice. What
they refuse is remembered, and the account page at `/account` lists every
service with what it can see and a way to remove its access, which revokes its
tokens at once.

| Scope | Claims |
| --- | --- |
| `openid` | `sub`, `amr` |
| `email` | `email`, `email_verified` |
| `profile` | `name`, `updated_at` |
| `phone` | `phone_number`, `phone_number_verified` |
| `address` | `address` (mailing) |
| `residential_address` | `residential_address` |
| `offline_access` | a refresh token |

## Claims from other services

A service can own scopes whose claims it keeps itself:

```bash
FG_ID_SERVICE_MEMBERS_CLAIMS=membership        # scope:claim,claim — here, both "membership"
```

When a person shares `membership` with another service, this one POSTs a
`ClaimsReview` to members at `<URL>/api/v1alpha1/claimsreviews` (or
`_CLAIMS_ENDPOINT`) and passes on what it answers, much as Kubernetes sends an
admission review. Nothing is copied here. The request carries a JWT signed
with the current token key, typed `fg-claims-review+jwt` and addressed to the
service, which checks it against this service's JWKS. The contract is in the
OpenAPI document's `webhooks`; `apps/members` implements it.

## REST API

The pages call a Kubernetes-style API, one route file per resource under
`app/api/`:

- `/api` and `/api/v1alpha1` list the versions and resources
- `/api/v1alpha1/<resource>[/<name>[/<subresource>]]` serves them
- `/api/openapi/v3` is the OpenAPI 3.1 document

Objects have `apiVersion: id.fairgarden.org/v1alpha1`, `kind`, `metadata`,
`spec` and `status`; lists are `<Kind>List`; every error is a `Status`;
updates are JSON merge patches, refused with 409 when `metadata.resourceVersion`
is stale. `v1alpha1` means it can still change. The routes and their Zod
schemas are in `lib/server/api-*.ts` and `lib/api/schemas.ts`, and the OpenAPI
document is generated from them.

The OIDC endpoints themselves are oidc-provider's, at `/oidc/*`, with
discovery at `/.well-known/openid-configuration`.

## Database

Drizzle, over `pg`. The schema is `lib/server/schema.ts`; migrations are in
`drizzle/`.

```bash
pnpm db:generate --name add-thing   # write the next migration from the schema
pnpm db:migrate                     # apply what is pending
pnpm db:rollback [--steps N | --to TAG]
pnpm db:status
pnpm db:studio
```

drizzle-kit writes each migration forward; its rollback is the hand-written
`<tag>.down.sql` beside it, which `db:generate` leaves as a stub. Migrations
run in order, one transaction each, under a lock, and one edited after it ran
is refused. A real database is only migrated by `db:migrate`, so a deployment
never changes its schema by surprise; on Vercel, run it before `next build`.

## Keys

Token signing keys and cookie secrets live in the database and rotate by
themselves every 30 days (`FG_ID_KEY_ROTATION_DAYS`). A new key is published
a day before it signs anything, and kept for two rotations after, so services
that cache the JWKS never see a token they cannot verify. Running instances
pick up a change within a minute.

```bash
pnpm keys list
pnpm keys rotate [--retire]         # sign with a new key now, as after a leak
```

To keep keys in a secret store instead, set `FG_ID_JWKS` (`pnpm keys
generate` prints one; `pnpm keys rotate --env` prints the next) and
`FG_ID_COOKIE_SECRETS`.

## Policy

Authorization goes through one place, `lib/server/policy.ts`, built on
[@fairgarden/policy](https://github.com/fairgarden/policy): `authz` (may this person do this
to this resource — a Kubernetes SubjectAccessReview's attributes) and
`release` (which scopes may this service be offered, and why not the others).
The built-in rules answer until an organization says otherwise.

`policies/id.rego` is the same rules in Rego, with places for an
organization's own (`deny`, `withheld`). In a distribution, the organization
writes its rules in its `policies/`, the distribution builds them on id's
once, and id's build takes a copy (`fg-dist policy use`) to run in process —
no OPA server, nothing to publish. `examples/privacy` is an organization's
rules to start from.

```bash
pnpm policy:test                                        # id's rules and tests
fg-policy test --base policies --dir examples/privacy   # with an organization's on top
```

`/policy` shows the policy in force to anyone: every decision in the
organization's words, every rule, and where each came from.

Every decision is recorded in `id_policy_decisions`, in OPA's decision log
format, labelled with the revision of the policy that made it, and kept 400
days (`FG_ID_POLICY_LOG_RETENTION_DAYS`); every revision is kept in
`id_policy_revisions`, so a decision can be read beside its rules.
`pnpm policy:log` exports them as JSON lines for an audit, and
`FG_ID_POLICY_LOG_STDOUT=true` also writes each to standard output for a log
drain.

Policy is meant to be seen. Every reason `release` gives for withholding a
scope is shown on the consent screen, and so is every reason another service's
own policy gives for what it keeps back (`ClaimsReview.response.reasons`).
People can read the decisions made about them on the account page, or at
`/api/v1alpha1/policydecisions`. Each service asks its own questions of the
same policy: members' are in `apps/members/policies`.

## Deploying on Vercel

1. Connect Neon, which sets `DATABASE_URL`, and run `pnpm db:migrate` as part
   of the build.
2. Set `FG_ID_URL` to the domain, `FG_ID_NAME`, `FG_ID_SMTP_URL` and
   `FG_ID_EMAIL_FROM`, and a group of `FG_ID_SERVICE_*` per service.
3. Keys need nothing: they are created on first use.

A monolith mounting this app must list `oidc-provider` in its own
`serverExternalPackages`: oidc-provider relies on its class names, which a
bundle would minify.

## URLs

`/account` is where people manage their details, passkeys and services;
`/login` starts signing in to it. `/interaction/<uid>` is where signing in to
any service happens, and `/sign-out`, `/signed-out` and `/error` are pages
oidc-provider sends people to. `/` is a short introduction.

`/en/…` redirects to the same path without the prefix. A `theme` cookie of
`light` or `dark` selects a variant of every page rendered with that theme on
`<html>`, and every variant is prerendered. The locale, theme and flags are
declared in `lib/indicators.ts` and put into the path by
`@fairgarden/indicators`; link with the `Link` from `lib/link.ts` rather than
`next/link`.
