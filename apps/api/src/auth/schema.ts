import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// better-auth core tables (user, session, account, verification), prefixed
// bauth_ like Platinum's, without the org / admin / oauth plugin tables.

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
