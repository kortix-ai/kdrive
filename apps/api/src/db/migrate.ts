import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

export const MIGRATIONS_DIR = path.join(import.meta.dir, '../../drizzle/migrations');

/** Applies drizzle/migrations to `url` (never db:push). */
export async function runMigrations(url: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/volumes_dev';
  const safe = url.replace(/\/\/[^@/]*@/, '//***@');
  runMigrations(url)
    .then(() => {
      console.log(`migrations applied to ${safe}`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(`migration failed for ${safe}:`, e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
