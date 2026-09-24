import * as z from 'zod'
import { GROUP_VERSION } from './group.ts'

/**
 * Every object the REST API sends or accepts, as Zod schemas. They validate
 * requests on the server, generate the OpenAPI document, and give the pages
 * their types — import them with `import type` from a client component.
 *
 * The shapes follow Kubernetes: `metadata` says which object it is, `spec` is
 * what the caller may set, and `status` is what the service observed. A
 * collection is a `<Kind>List` of `items`, and every error is a `Status`.
 */

export const registry = z.registry<{ id: string; description?: string }>()

const define = <T extends z.ZodType>(id: string, description: string, schema: T): T => {
  ;(schema as z.ZodType).register(registry, { id, description })
  return schema
}

const apiVersion = z.literal(GROUP_VERSION)
const timestamp = z.string().describe('RFC 3339 date and time')

export const ObjectMeta = define(
  'ObjectMeta',
  'Identifies an object.',
  z.object({
    name: z.string(),
    creationTimestamp: timestamp.optional(),
    resourceVersion: z
      .string()
      .optional()
      .describe('Changes whenever the object does. Send it back to refuse overwriting a newer one.'),
  })
)

export const ListMeta = define(
  'ListMeta',
  'Describes a list.',
  z.object({ resourceVersion: z.string().optional() })
)

export const StatusReason = z.enum([
  'BadRequest',
  'Unauthorized',
  'Forbidden',
  'NotFound',
  'AlreadyExists',
  'Conflict',
  'Gone',
  'Invalid',
  'Expired',
  'TooManyRequests',
  'MethodNotAllowed',
  'NotAcceptable',
  'UnsupportedMediaType',
  'InternalError',
  'ServiceUnavailable',
])

export const StatusCause = z.object({
  field: z.string().optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
})

export const Status = define(
  'Status',
  'The outcome of a request that returns no object, and every error.',
  z.object({
    apiVersion: z.literal('v1'),
    kind: z.literal('Status'),
    metadata: z.object({}),
    status: z.enum(['Success', 'Failure']),
    message: z.string().optional(),
    reason: StatusReason.optional(),
    code: z.number().int(),
    details: z
      .object({
        name: z.string().optional(),
        group: z.string().optional(),
        kind: z.string().optional(),
        causes: z.array(StatusCause).optional(),
        retryAfterSeconds: z.number().int().optional(),
      })
      .optional(),
  })
)

export const Issuer = define(
  'Issuer',
  'This service, as it presents itself.',
  z.object({ name: z.string(), url: z.string() })
)

const text = (max: number) => z.string().trim().min(1).max(max)

export const Address = define(
  'Address',
  'A postal address. `formatted` is derived from the other parts.',
  z.object({
    streetAddress: text(500).optional().describe('Every line before the locality'),
    locality: text(200).optional(),
    region: text(200).optional(),
    postalCode: text(40).optional(),
    country: text(100).optional(),
    formatted: z.string().optional().describe('Read only'),
  })
)

export const AccountSpec = define(
  'AccountSpec',
  'What a person tells this service about themselves.',
  z.object({
    displayName: text(200).nullable(),
    phoneNumber: z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9 ().-]{3,30}$/, 'Enter a phone number, like +1 555 010 0000')
      .nullable(),
    mailingAddress: Address.nullable(),
    residentialAddress: Address.nullable(),
  })
)

export const Account = define(
  'Account',
  'A person. Only they can see or change it.',
  z.object({
    apiVersion,
    kind: z.literal('Account'),
    metadata: ObjectMeta,
    spec: AccountSpec,
    status: z.object({ email: z.string(), emailVerified: z.boolean() }),
  })
)

export const AccountPatch = define(
  'AccountPatch',
  'A JSON merge patch (RFC 7386) of an Account: `null` removes a field.',
  z.object({
    metadata: z.object({ resourceVersion: z.string().optional() }).optional(),
    spec: z.record(z.string(), z.unknown()).optional(),
  })
)

export const RegistrationCredential = define(
  'RegistrationCredential',
  "What the browser's `navigator.credentials.create()` returned, as JSON.",
  z.looseObject({
    id: z.string(),
    rawId: z.string(),
    type: z.literal('public-key'),
    response: z.looseObject({ clientDataJSON: z.string(), attestationObject: z.string() }),
  })
)

export const AuthenticationCredential = define(
  'AuthenticationCredential',
  "What the browser's `navigator.credentials.get()` returned, as JSON.",
  z.looseObject({
    id: z.string(),
    rawId: z.string(),
    type: z.literal('public-key'),
    response: z.looseObject({
      clientDataJSON: z.string(),
      authenticatorData: z.string(),
      signature: z.string(),
    }),
  })
)

export const Passkey = define(
  'Passkey',
  "One of a person's passkeys.",
  z.object({
    apiVersion,
    kind: z.literal('Passkey'),
    metadata: ObjectMeta,
    spec: z.object({ displayName: text(100) }),
    status: z.object({
      deviceType: z.enum(['singleDevice', 'multiDevice']),
      backedUp: z.boolean(),
      transports: z.array(z.string()),
      lastUsedTimestamp: timestamp.nullable(),
    }),
  })
)

export const PasskeyList = define(
  'PasskeyList',
  'A list of passkeys.',
  z.object({
    apiVersion,
    kind: z.literal('PasskeyList'),
    metadata: ListMeta,
    items: z.array(Passkey),
  })
)

const request = <K extends string, S extends z.ZodType>(kind: K, spec: S) =>
  z.object({
    apiVersion: apiVersion.optional(),
    kind: z.literal(kind).optional(),
    metadata: z.object({ name: z.string().optional() }).optional(),
    spec,
  })

export const PasskeyCreate = define(
  'PasskeyCreate',
  'Register a passkey, answering a PasskeyChallenge made for registering.',
  request(
    'Passkey',
    z.object({ displayName: text(100).optional(), credential: RegistrationCredential })
  )
)

export const PasskeyPatch = define(
  'PasskeyPatch',
  'A JSON merge patch of a Passkey.',
  z.object({ spec: z.object({ displayName: text(100) }) })
)

export const PasskeyChallengeCreate = define(
  'PasskeyChallengeCreate',
  'Ask for the options to pass to the browser.',
  request('PasskeyChallenge', z.object({ purpose: z.enum(['Authenticate', 'Register']) }))
)

export const PasskeyChallenge = define(
  'PasskeyChallenge',
  'Options for `navigator.credentials`, good for one attempt.',
  z.object({
    apiVersion,
    kind: z.literal('PasskeyChallenge'),
    metadata: ObjectMeta,
    spec: z.object({ purpose: z.enum(['Authenticate', 'Register']) }),
    status: z.object({
      options: z.record(z.string(), z.unknown()).describe('PublicKeyCredential options, as JSON'),
      expiresTimestamp: timestamp,
    }),
  })
)

export const ClientInfo = define(
  'ClientInfo',
  'A service that signs people in with this one.',
  z.object({ id: z.string(), name: z.string(), uri: z.string().nullable() })
)

export const Grant = define(
  'Grant',
  "What a person has agreed to share with a service. Deleting it removes the service's access.",
  z.object({
    apiVersion,
    kind: z.literal('Grant'),
    metadata: ObjectMeta,
    spec: z.object({
      clientId: z.string(),
      scopes: z.array(z.string()),
      rejectedScopes: z.array(z.string()),
    }),
    status: z.object({
      client: ClientInfo,
      shared: z
        .array(z.object({ name: z.string(), title: z.string() }))
        .describe('The granted scopes, as a person would read them'),
    }),
  })
)

export const GrantList = define(
  'GrantList',
  'A list of grants.',
  z.object({ apiVersion, kind: z.literal('GrantList'), metadata: ListMeta, items: z.array(Grant) })
)

export const Session = define(
  'Session',
  'Who is signed in to this service in this browser, if anyone. `current` is the only one.',
  z.object({
    apiVersion,
    kind: z.literal('Session'),
    metadata: ObjectMeta,
    status: z.object({
      authenticated: z.boolean(),
      account: z
        .object({ name: z.string(), email: z.string(), displayName: z.string().nullable() })
        .nullable(),
      issuer: Issuer,
      signInUrl: z.string(),
      signOutUrl: z.string().nullable(),
    }),
  })
)

export const ScopeRequest = define(
  'ScopeRequest',
  'A scope a service asked for, as a person is asked to agree to it.',
  z.object({
    name: z.string(),
    title: z.string(),
    description: z.string(),
    claims: z.array(z.string()),
    sensitive: z.boolean().describe('Never agreed to on the person’s behalf'),
    required: z.boolean(),
    source: z.string().nullable().describe('The service that supplies it, when not this one'),
    available: z.boolean().describe('Whether policy lets this service have it at all'),
    reason: z
      .string()
      .nullable()
      .describe('Why policy keeps it from this service, in words to show the person'),
    preview: z.array(z.string()).nullable().describe('What would be shared, where known'),
    previously: z
      .enum(['granted', 'refused'])
      .nullable()
      .describe('What the person answered last time, when the service asks again'),
  })
)

export const InteractionPhase = z.enum([
  'LoginRequired',
  'Authenticated',
  'ConsentRequired',
  'Completed',
  'Aborted',
])

export const Interaction = define(
  'Interaction',
  'A sign-in in progress, bound to the browser that started it.',
  z.object({
    apiVersion,
    kind: z.literal('Interaction'),
    metadata: ObjectMeta,
    spec: z.object({
      prompt: z.enum(['login', 'consent']),
      issuer: Issuer,
      client: ClientInfo,
      loginHint: z.string().nullable(),
      scopes: z.array(z.string()).describe('Every scope the service asked for'),
    }),
    status: z.object({
      phase: InteractionPhase,
      account: z
        .object({
          name: z.string(),
          email: z.string(),
          displayName: z.string().nullable(),
          passkeys: z.number().int(),
        })
        .nullable(),
      emailChallenge: z
        .object({
          email: z.string(),
          expiresTimestamp: timestamp,
          mockMailbox: z
            .string()
            .nullable()
            .describe('Where to read the email, when email is mocked for local development'),
        })
        .nullable(),
      consent: z.object({ scopes: z.array(ScopeRequest) }).nullable(),
      returnTo: z.string().nullable().describe('Where to send the browser next'),
    }),
  })
)

export const EmailChallengeCreate = define(
  'EmailChallengeCreate',
  'Email a sign-in code and link.',
  request('EmailChallenge', z.object({ email: z.email().max(254) }))
)

export const EmailChallenge = define(
  'EmailChallenge',
  'A sign-in email that was sent.',
  z.object({
    apiVersion,
    kind: z.literal('EmailChallenge'),
    metadata: ObjectMeta,
    spec: z.object({ email: z.string() }),
    status: z.object({ expiresTimestamp: timestamp, resendAfterTimestamp: timestamp }),
  })
)

export const LoginCreate = define(
  'LoginCreate',
  'Prove who is signing in: the emailed code, the emailed link, or a passkey.',
  request(
    'Login',
    z.discriminatedUnion('method', [
      z.object({ method: z.literal('EmailCode'), code: z.string().trim().regex(/^\d{6}$/) }),
      z.object({ method: z.literal('EmailLink'), token: z.string().min(20).max(200) }),
      z.object({ method: z.literal('Passkey'), credential: AuthenticationCredential }),
    ])
  )
)

export const ConsentCreate = define(
  'ConsentCreate',
  'The scopes a person agreed to share. Any other requested scope is refused.',
  request('Consent', z.object({ scopes: z.array(z.string()) }))
)

export const MockMessage = define(
  'MockMessage',
  'An email the mock transport would have sent.',
  z.object({
    apiVersion,
    kind: z.literal('MockMessage'),
    metadata: ObjectMeta,
    spec: z.object({ to: z.string(), subject: z.string(), text: z.string(), html: z.string() }),
  })
)

export const MockMessageList = define(
  'MockMessageList',
  'A list of mock emails, newest first.',
  z.object({
    apiVersion,
    kind: z.literal('MockMessageList'),
    metadata: ListMeta,
    items: z.array(MockMessage),
  })
)

export const PolicyDecision = define(
  'PolicyDecision',
  'A decision policy made about the signed-in person, as recorded for audits.',
  z.object({
    apiVersion,
    kind: z.literal('PolicyDecision'),
    metadata: ObjectMeta,
    spec: z.object({
      decision: z.string().describe('The rule asked: `authz` or `release`'),
      path: z.string(),
      input: z.unknown().optional(),
    }),
    status: z.object({
      result: z.unknown().optional(),
      error: z.string().nullable().describe('Why no decision could be made, which counts as no'),
      summary: z.string().describe('What was decided, in words'),
      engine: z.string().describe('`builtin`, `bundle` or `server`'),
      revision: z.string().describe('Which rules answered'),
      erased: z.array(z.string()).describe('What was left out of the record'),
    }),
  })
)

export const PolicyDecisionList = define(
  'PolicyDecisionList',
  'A list of policy decisions, newest first.',
  z.object({
    apiVersion,
    kind: z.literal('PolicyDecisionList'),
    metadata: ListMeta,
    items: z.array(PolicyDecision),
  })
)

const RelatedResource = z.object({
  ref: z.string().describe('A link, such as the article of the bylaws a rule enforces'),
  description: z.string().optional(),
})

export const Policy = define(
  'Policy',
  "The policy in force, for the people it governs: what each decision is for in the organization's words, the rules, and who signed them. Anyone may read it.",
  z.object({
    apiVersion,
    kind: z.literal('Policy'),
    metadata: ObjectMeta,
    spec: z.object({
      engine: z
        .enum(['builtin', 'bundle', 'server'])
        .describe("`builtin`: the service's own rules. `bundle`: the organization's, run here. `server`: an OPA server's"),
      revision: z
        .string()
        .optional()
        .describe("Which revision of the organization's policy: the distribution's version, and a digest of the rules and settings"),
      commit: z.string().optional().describe('The commit it was built from'),
      organization: z
        .record(z.string(), z.unknown())
        .describe('What the organization says about itself in the policy: its name, where the policy is kept'),
      layers: z
        .array(
          z.object({
            path: z.string(),
            role: z
              .enum(['base', 'parent', 'organization'])
              .describe(
                "`base`: a service's rules, as it ships them. `parent`: the policy of a distribution this one extends. `organization`: what the organization added"
              ),
            package: z.string().optional(),
            version: z.string().optional(),
          })
        )
        .describe('What the policy was built from, in order'),
      packages: z.array(
        z.object({
          name: z.string().describe('The Rego package: `fairgarden.id`'),
          title: z.string().optional(),
          description: z.string().optional(),
          related: z.array(RelatedResource),
          decisions: z.array(
            z.object({
              name: z.string(),
              path: z.string(),
              title: z.string().optional(),
              description: z.string().optional(),
              related: z.array(RelatedResource),
            })
          ),
          sources: z
            .array(z.object({ path: z.string(), layer: z.string().optional(), text: z.string() }))
            .describe('The Rego, as written'),
        })
      ),
      settings: z.unknown().describe("The settings the rules read: the policy's data"),
    }),
    status: z.object({
      phase: z
        .enum(['Active', 'Refused', 'Unavailable', 'Undisclosed'])
        .describe(
          '`Active`: deciding, as described. `Refused`: a bundle from elsewhere is not signed by the organization, so nothing it would decide is allowed. `Unavailable`: the policy could not be read, with the same result. `Undisclosed`: an OPA server holds the rules'
        ),
      message: z.string().optional(),
      signature: z
        .object({ keyId: z.string(), algorithm: z.string() })
        .nullable()
        .describe('The key that signed it; null when nothing was signed'),
    }),
  })
)

export const ClaimsReview = define(
  'ClaimsReview',
  'Sent to a service that supplies claims, which answers with the same object and a `response`.',
  z.object({
    apiVersion,
    kind: z.literal('ClaimsReview'),
    request: z
      .object({
        uid: z.string().describe('Echo it back in the response'),
        purpose: z
          .enum(['Release', 'Preview'])
          .describe('Release: they go to `client`. Preview: shown to the person, who is deciding.'),
        subject: z.string().describe('The account, as `sub`'),
        client: z.object({ id: z.string(), name: z.string() }),
        scopes: z.array(z.string()),
        claims: z.array(z.string()).describe('The claims those scopes carry; others are dropped'),
      })
      .optional(),
    response: z
      .object({
        uid: z.string(),
        claims: z.record(z.string(), z.unknown()),
        reasons: z
          .record(z.string(), z.string())
          .optional()
          .describe('What was withheld, and why, in words the person is shown'),
      })
      .optional(),
  })
)

export type Status = z.infer<typeof Status>
export type StatusReason = z.infer<typeof StatusReason>
export type Address = z.infer<typeof Address>
export type AccountSpec = z.infer<typeof AccountSpec>
export type Account = z.infer<typeof Account>
export type Passkey = z.infer<typeof Passkey>
export type PasskeyList = z.infer<typeof PasskeyList>
export type PasskeyChallenge = z.infer<typeof PasskeyChallenge>
export type Grant = z.infer<typeof Grant>
export type GrantList = z.infer<typeof GrantList>
export type Session = z.infer<typeof Session>
export type ScopeRequest = z.infer<typeof ScopeRequest>
export type Interaction = z.infer<typeof Interaction>
export type InteractionPhase = z.infer<typeof InteractionPhase>
export type EmailChallenge = z.infer<typeof EmailChallenge>
export type LoginCreate = z.infer<typeof LoginCreate>
export type MockMessage = z.infer<typeof MockMessage>
export type MockMessageList = z.infer<typeof MockMessageList>
export type ClaimsReview = z.infer<typeof ClaimsReview>
export type Policy = z.infer<typeof Policy>
export type PolicyDecision = z.infer<typeof PolicyDecision>
export type PolicyDecisionList = z.infer<typeof PolicyDecisionList>
