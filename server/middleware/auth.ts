import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../db/supabase.js';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }
  const token = header.slice(7);
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
    (req as any).user = { id: data.user.id, email: data.user.email };
    next();
  } catch (err) {
    console.error('[auth]', err);
    return res.status(401).json({ error: 'Authentication failed.' });
  }
}
