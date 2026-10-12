import { verifyPassword as verifyScrypt } from 'better-auth/crypto';

/**
 * Password hashing, as in Platinum: argon2id through Bun.password (OWASP's
 * minimum profile, 19 MiB / 2 passes). New and changed passwords are stored as
 * `$argon2id$…`; hashes written before the switch (better-auth's default
 * scrypt, `salt:key` hex) still verify, and are replaced the next time the
 * password is changed or reset.
 */
export const ARGON2 = { algorithm: 'argon2id', memoryCost: 19 * 1024, timeCost: 2 } as const;

export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, ARGON2);
}

export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  if (!hash) return false;
  try {
    if (hash.startsWith('$argon2') || hash.startsWith('$2')) return await Bun.password.verify(password, hash);
    return await verifyScrypt({ hash, password });
  } catch {
    return false;
  }
}
