import 'express';

declare global {
  namespace Express {
    interface Request {
      /** Set by `SalomDriverGuard` when `X-Salom-Driver-Id` is valid. */
      salomDriverId?: string;
      /** Set by `SalomOperatorGuard` when `X-Salom-Operator-Id` is valid. */
      salomOperatorId?: string;
      /** Set by `SalomAdminGuard` */
      salomAdminId?: string;
      /** Admin `User.id` (audit) */
      salomAdminUserId?: string;
    }
  }
}

export {};
