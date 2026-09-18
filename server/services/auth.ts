import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

const JWT_SECRET = () => process.env.JWT_SECRET ?? 'dev-only-secret-change-me-0123456789';
const EXPIRES = () => process.env.JWT_EXPIRES_IN ?? '7d';

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}
export function signToken(userId: string): string {
  return (jwt as unknown as { sign: (p: object, s: string, o: object) => string }).sign(
    { sub: userId }, JWT_SECRET(), { expiresIn: EXPIRES() },
  );
}
export function verifyToken(token: string): string | null {
  try {
    const v = (jwt as unknown as { verify: (t: string, s: string) => { sub?: string } }).verify(token, JWT_SECRET());
    return v.sub ?? null;
  } catch { return null; }
}

export const registerSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_.]+$/, 'Letters, numbers, _ and . only'),
  displayName: z.string().min(1).max(64),
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
});
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});
export const profilePatchSchema = z.object({
  displayName: z.string().min(1).max(64).optional(),
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_.]+$/, 'Letters, numbers, _ and . only').optional(),
  email: z.string().email().max(254).optional(),
  customStatus: z.string().max(128).nullable().optional(),
  bio: z.string().max(512).nullable().optional(),
  status: z.enum(['online', 'idle', 'dnd', 'invisible', 'offline']).optional(),
  avatar: z.string().max(700_000).nullable().optional(),
}).refine((v) => v.avatar == null || v.avatar.length <= 8 || v.avatar.startsWith('data:image/'), {
  message: 'Avatar must be an emoji or an uploaded image',
});
export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});
export const messageSchema = z.object({
  content: z.string().max(2000),
  replyTo: z.string().nullable().optional(),
  clientId: z.string().max(64).nullable().optional(),
  attachments: z.array(z.object({
    id: z.string(), name: z.string().max(255), mime: z.string().max(127),
    size: z.number().max(25 * 1024 * 1024), url: z.string().max(35_000_000),
  })).max(10).optional(),
}).refine((v) => v.content.trim().length > 0 || (v.attachments?.length ?? 0) > 0, {
  message: 'Message must have text or an attachment',
});
export const serverSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(16).nullable().optional(),
});
export const channelSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-_ ]+$/i, 'Simple names only'),
  type: z.enum(['text', 'voice', 'announcement', 'category']),
  categoryId: z.string().nullable().optional(),
  topic: z.string().max(1024).nullable().optional(),
});
