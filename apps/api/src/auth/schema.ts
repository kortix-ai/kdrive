import { boolean, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// better-auth core tables (user, session, account, verification), prefixed
// bauth_ like Platinum's, plus the OAuth provider + JWKS tables that agent
// access uses (no org / admin plugin tables).

const tz = { withTimezone: true } as const;

export const bauthUser = pgTable('bauth_user', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique('bauth_user_email_key'),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name'),
  image: text('image'),
  createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', tz).defaultNow().notNull(),
});

export const bauthSession = pgTable(
  'bauth_session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => bauthUser.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique('bauth_session_token_key'),
    expiresAt: timestamp('expires_at', tz).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', tz).defaultNow().notNull(),
  },
  (t) => [index('bauth_session_user_idx').on(t.userId)],
);

export const bauthAccount = pgTable(
  'bauth_account',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => bauthUser.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', tz),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', tz),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', tz).defaultNow().notNull(),
  },
  (t) => [
    index('bauth_account_user_idx').on(t.userId),
    index('bauth_account_provider_idx').on(t.providerId, t.accountId),
  ],
);

export const bauthVerification = pgTable(
  'bauth_verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', tz).notNull(),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', tz).defaultNow().notNull(),
  },
  (t) => [index('bauth_verification_identifier_idx').on(t.identifier)],
);

// ── OAuth 2.1 provider (@better-auth/oauth-provider) + jwt plugin ──────────
// Exact adapter models the plugin reads and writes. Arrays stay native
// Postgres text[]: the provider compares them as arrays and must never
// receive JSON-encoded strings.

export const bauthOAuthClient = pgTable(
  'bauth_oauth_client',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull().unique('bauth_oauth_client_client_id_key'),
    clientSecret: text('client_secret'),
    disabled: boolean('disabled').notNull().default(false),
    skipConsent: boolean('skip_consent'),
    enableEndSession: boolean('enable_end_session'),
    subjectType: text('subject_type'),
    scopes: text('scopes').array(),
    userId: text('user_id').references(() => bauthUser.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', tz).defaultNow().notNull(),
    name: text('name'),
    uri: text('uri'),
    icon: text('icon'),
    contacts: text('contacts').array(),
    tos: text('tos'),
    policy: text('policy'),
    softwareId: text('software_id'),
    softwareVersion: text('software_version'),
    softwareStatement: text('software_statement'),
    redirectUris: text('redirect_uris').array().notNull(),
    postLogoutRedirectUris: text('post_logout_redirect_uris').array(),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
    grantTypes: text('grant_types').array(),
    responseTypes: text('response_types').array(),
    public: boolean('public'),
    type: text('type'),
    requirePKCE: boolean('require_pkce'),
    referenceId: text('reference_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('bauth_oauth_client_user_idx').on(t.userId),
    index('bauth_oauth_client_reference_idx').on(t.referenceId),
  ],
);

export const bauthOAuthRefreshToken = pgTable(
  'bauth_oauth_refresh_token',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique('bauth_oauth_refresh_token_token_key'),
    clientId: text('client_id')
      .notNull()
      .references(() => bauthOAuthClient.clientId, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => bauthSession.id, { onDelete: 'set null' }),
    userId: text('user_id')
      .notNull()
      .references(() => bauthUser.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    expiresAt: timestamp('expires_at', tz).notNull(),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    revoked: timestamp('revoked', tz),
    authTime: timestamp('auth_time', tz),
    scopes: text('scopes').array().notNull(),
  },
  (t) => [
    index('bauth_oauth_refresh_token_client_idx').on(t.clientId),
    index('bauth_oauth_refresh_token_session_idx').on(t.sessionId),
    index('bauth_oauth_refresh_token_user_idx').on(t.userId),
    index('bauth_oauth_refresh_token_reference_idx').on(t.referenceId),
  ],
);

export const bauthOAuthAccessToken = pgTable(
  'bauth_oauth_access_token',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique('bauth_oauth_access_token_token_key'),
    clientId: text('client_id')
      .notNull()
      .references(() => bauthOAuthClient.clientId, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => bauthSession.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => bauthUser.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    refreshId: text('refresh_id').references(() => bauthOAuthRefreshToken.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', tz).notNull(),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    scopes: text('scopes').array().notNull(),
  },
  (t) => [
    index('bauth_oauth_access_token_client_idx').on(t.clientId),
    index('bauth_oauth_access_token_session_idx').on(t.sessionId),
    index('bauth_oauth_access_token_user_idx').on(t.userId),
    index('bauth_oauth_access_token_refresh_idx').on(t.refreshId),
    index('bauth_oauth_access_token_reference_idx').on(t.referenceId),
  ],
);

export const bauthOAuthConsent = pgTable(
  'bauth_oauth_consent',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => bauthOAuthClient.clientId, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => bauthUser.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    scopes: text('scopes').array().notNull(),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', tz).defaultNow().notNull(),
  },
  (t) => [
    index('bauth_oauth_consent_client_idx').on(t.clientId),
    index('bauth_oauth_consent_user_idx').on(t.userId),
    index('bauth_oauth_consent_reference_idx').on(t.referenceId),
  ],
);

export const bauthJwks = pgTable('bauth_jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', tz),
});
