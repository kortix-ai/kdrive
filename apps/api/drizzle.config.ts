import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: ['./src/auth/schema.ts', './src/db/schema.ts'],
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/volumes_dev' },
  strict: true,
  verbose: false,
});
