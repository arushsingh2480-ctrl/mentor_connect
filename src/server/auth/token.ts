import crypto from 'crypto';

// Lightweight HMAC-signed session token (no extra dependency).
// Format: base64url(payload).base64url(hmac_sha256(payload))
const SECRET = () => process.env.JWT_SECRET || 'mentor_connect_dev_secret_change_me';
const TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function signToken(userId: string): string {
  const payload = b64(JSON.stringify({ uid: userId, exp: Date.now() + TTL_MS }));
  const sig = crypto.createHmac('sha256', SECRET()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token?: string | null): string | null {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!uid || typeof exp !== 'number' || exp < Date.now()) return null;
    return uid as string;
  } catch {
    return null;
  }
}
