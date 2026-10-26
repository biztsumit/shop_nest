import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

// Coupons arrive in step 4.3. Until then, no code is valid, and orders call these three
// methods at the right moments: check (quote), redeem (placing), release (cancel/expire).
@Injectable()
export class CouponsService {
  check(_db: Prisma.TransactionClient, _userId: string, _code: string, _subtotal: number): Promise<{ discount: number }> {
    return Promise.reject(new NotFoundException('No such coupon'));
  }

  redeem(_tx: Prisma.TransactionClient, _userId: string, _code: string, _subtotal: number, _orderId: string): Promise<{ discount: number }> {
    return Promise.reject(new NotFoundException('No such coupon'));
  }

  release(_tx: Prisma.TransactionClient, _orderId: string): Promise<void> {
    return Promise.resolve();
  }
}
