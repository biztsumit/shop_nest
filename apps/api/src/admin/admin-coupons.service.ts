import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { formatPrice, type Coupon, type CreateCoupon, type UpdateCoupon } from '@shop/shared';
import { AuditService } from '../audit/audit.service.js';
import { describeChanges, diffChanges } from '../audit/changes.js';
import type { Coupon as CouponRow } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { rethrowUnique } from './prisma-errors.js';

@Injectable()
export class AdminCouponsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<Coupon[]> {
    return (await this.prisma.coupon.findMany({ orderBy: { id: 'desc' } })).map(toCoupon);
  }

  async create(input: CreateCoupon, actorId: string): Promise<Coupon> {
    try {
      return toCoupon(await this.prisma.$transaction(async (tx) => {
        const coupon = await tx.coupon.create({ data: { ...input, startsAt: toDate(input.startsAt), endsAt: toDate(input.endsAt) } });
        const gives = coupon.type === 'PERCENT' ? `${coupon.value}% off` : `${formatPrice(coupon.value)} off`;
        await this.audit.record(tx, { actorId, action: 'coupon.create', entityType: 'coupon', entityId: coupon.id, summary: `Created ${coupon.code} (${gives})` });
        return coupon;
      }));
    } catch (err) {
      return rethrowUnique(err, { code: 'A coupon with this code already exists.' });
    }
  }

  async update(id: string, input: UpdateCoupon, actorId: string): Promise<Coupon> {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException('No such coupon');
    // Rules about SEVERAL fields, checked on the coupon as it will be after this change
    const type = input.type ?? coupon.type;
    const value = input.value ?? coupon.value;
    const startsAt = input.startsAt === undefined ? coupon.startsAt : input.startsAt && new Date(input.startsAt);
    const endsAt = input.endsAt === undefined ? coupon.endsAt : input.endsAt && new Date(input.endsAt);
    const usageLimit = input.usageLimit === undefined ? coupon.usageLimit : input.usageLimit;
    if (type === 'PERCENT' && value > 90) throw new UnprocessableEntityException('A percentage can be at most 90.');
    if (startsAt && endsAt && startsAt >= endsAt) throw new UnprocessableEntityException('The end must be after the start.');
    if (usageLimit !== null && usageLimit < coupon.usedCount) {
      throw new UnprocessableEntityException(`It has already been used ${coupon.usedCount} times: the limit can't be lower than that.`);
    }
    const { startsAt: _startsAt, endsAt: _endsAt, ...fields } = input;
    const data = {
      ...fields,
      ...(input.startsAt !== undefined ? { startsAt: toDate(input.startsAt) } : {}),
      ...(input.endsAt !== undefined ? { endsAt: toDate(input.endsAt) } : {}),
    };
    return toCoupon(await this.prisma.$transaction(async (tx) => {
      const updated = await tx.coupon.update({ where: { id }, data });
      const changes = diffChanges(coupon, data);
      if (Object.keys(changes).length > 0) {
        await this.audit.record(tx, { actorId, action: 'coupon.update', entityType: 'coupon', entityId: id, summary: `${coupon.code}: ${describeChanges(changes, COUPON_LABELS)}`, changes });
      }
      return updated;
    }));
  }
}

const toDate = (iso: string | null): Date | null => (iso ? new Date(iso) : null);

const money = (value: unknown) => (value === null ? '(none)' : formatPrice(Number(value)));
const COUPON_LABELS = {
  active: ['status', (v: unknown) => (v ? 'live' : 'paused')],
  value: 'value',
  minSubtotal: ['minimum order', money],
  maxDiscount: ['most off', money],
  usageLimit: ['total uses', (v: unknown) => (v === null ? 'no limit' : String(v as number))],
  perUserLimit: 'uses per shopper',
  startsAt: 'start',
  endsAt: 'end',
  description: 'description',
} satisfies Parameters<typeof describeChanges>[1];

const toCoupon = (c: CouponRow): Coupon => ({
  id: c.id,
  code: c.code,
  description: c.description,
  type: c.type,
  value: c.value,
  minSubtotal: c.minSubtotal,
  maxDiscount: c.maxDiscount,
  startsAt: c.startsAt?.toISOString() ?? null,
  endsAt: c.endsAt?.toISOString() ?? null,
  usageLimit: c.usageLimit,
  perUserLimit: c.perUserLimit,
  usedCount: c.usedCount,
  active: c.active,
  createdAt: c.createdAt.toISOString(),
});
