import { Request, Response, NextFunction } from 'express';
import { db } from '../db/database.ts';
import { verifyToken } from '../auth/token.ts';
import { User, UserRole } from '../../types/index.ts';

// Extend Express Request
export interface AuthenticatedRequest extends Request {
  user?: User;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const userId = verifyToken(token);

  if (!userId) {
    res.status(401).json({ success: false, error: 'Session expired or invalid. Please log in again.' });
    return;
  }

  const user = db.findUserById(userId);
  if (!user) {
    res.status(401).json({ success: false, error: 'User session not found or invalid.' });
    return;
  }

  if (user.isSuspended) {
    res.status(403).json({ success: false, error: 'Account has been suspended by administration.' });
    return;
  }

  req.user = user;
  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required.' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: `Access denied. Role "${req.user.role}" does not have permission for this resource.`
      });
      return;
    }

    next();
  };
}
