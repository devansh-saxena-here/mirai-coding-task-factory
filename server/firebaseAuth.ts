import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface VerifiedFirebaseUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  providerId: string | null;
}

interface FirebaseAppletConfig {
  projectId?: string;
}

const CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let cachedCerts: Record<string, string> | null = null;
let certsExpiresAt = 0;

function loadProjectId(): string {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (!fs.existsSync(configPath)) {
    throw Object.assign(new Error('Firebase configuration is missing on the server.'), { statusCode: 500 });
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as FirebaseAppletConfig;
  const projectId = (raw.projectId || '').trim();
  if (!projectId) {
    throw Object.assign(new Error('Firebase projectId is missing in firebase-applet-config.json.'), { statusCode: 500 });
  }
  return projectId;
}

async function getGooglePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && cachedCerts && now < certsExpiresAt) {
    return cachedCerts;
  }

  const resp = await fetch(CERTS_URL);
  if (!resp.ok) {
    throw Object.assign(new Error('Could not fetch Firebase signing certificates.'), { statusCode: 503 });
  }
  const certs = (await resp.json()) as Record<string, string>;
  const cacheControl = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  cachedCerts = certs;
  certsExpiresAt = now + Math.max(60, maxAgeSec) * 1000;
  return certs;
}

function decodeBase64UrlJson<T>(segment: string): T {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const json = Buffer.from(normalized + pad, 'base64').toString('utf8');
  return JSON.parse(json) as T;
}

function decodeBase64UrlBuffer(segment: string): Buffer {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

export async function verifyFirebaseIdToken(token: string): Promise<VerifiedFirebaseUser> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw Object.assign(new Error('Invalid authentication token format.'), { statusCode: 401 });
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  let header: { alg?: string; kid?: string };
  let payload: {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
    firebase?: { sign_in_provider?: string };
  };

  try {
    header = decodeBase64UrlJson(headerB64);
    payload = decodeBase64UrlJson(payloadB64);
  } catch {
    throw Object.assign(new Error('Malformed authentication token.'), { statusCode: 401 });
  }

  if (header.alg !== 'RS256' || !header.kid) {
    throw Object.assign(new Error('Unsupported authentication token algorithm.'), { statusCode: 401 });
  }

  const projectId = loadProjectId();
  let certs = await getGooglePublicCerts(false);
  let cert = certs[header.kid];
  if (!cert) {
    certs = await getGooglePublicCerts(true);
    cert = certs[header.kid];
  }
  if (!cert) {
    throw Object.assign(new Error('Unknown authentication token signing key.'), { statusCode: 401 });
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const signature = decodeBase64UrlBuffer(signatureB64);
  const validSig = verifier.verify(cert, signature);
  if (!validSig) {
    throw Object.assign(new Error('Invalid authentication token signature.'), { statusCode: 401 });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw Object.assign(new Error('Authentication session expired. Please sign in again.'), { statusCode: 401 });
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw Object.assign(new Error('Invalid authentication token issue time.'), { statusCode: 401 });
  }
  if (payload.aud !== projectId) {
    throw Object.assign(new Error('Authentication token audience mismatch.'), { statusCode: 401 });
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw Object.assign(new Error('Authentication token issuer mismatch.'), { statusCode: 401 });
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw Object.assign(new Error('Authentication token is missing user ID.'), { statusCode: 401 });
  }

  return {
    uid: payload.sub.trim(),
    email: typeof payload.email === 'string' ? payload.email : null,
    emailVerified: Boolean(payload.email_verified),
    name: typeof payload.name === 'string' ? payload.name : null,
    picture: typeof payload.picture === 'string' ? payload.picture : null,
    providerId: typeof payload.firebase?.sign_in_provider === 'string' ? payload.firebase.sign_in_provider : null,
  };
}
