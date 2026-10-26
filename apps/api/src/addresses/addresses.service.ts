import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MAX_ADDRESSES, type Address, type CreateAddress, type UpdateAddress } from '@shop/shared';
import type { Address as AddressRow, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Someone else's address answers "not found", exactly like one that doesn't exist: "forbidden"
// would confirm to a snooper that the id is real
const NOT_FOUND = 'No such address';

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  // The default first, then the newest
  async list(userId: string): Promise<Address[]> {
    const rows = await this.prisma.address.findMany({ where: { userId }, orderBy: [{ isDefault: 'desc' }, { id: 'desc' }] });
    return rows.map(toAddress);
  }

  async get(userId: string, id: string): Promise<Address> {
    return toAddress(await this.find(this.prisma, userId, id));
  }

  // The first address is the default automatically
  async create(userId: string, { isDefault, ...fields }: CreateAddress): Promise<Address> {
    const row = await this.prisma.$transaction(async (tx) => {
      // Locks this user's row: two "add address" requests at once queue up here, so both can't
      // see "9 addresses" and make 11 (or both be "the first" and both be default)
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const count = await tx.address.count({ where: { userId } });
      if (count >= MAX_ADDRESSES) {
        throw new ConflictException(`You can save up to ${MAX_ADDRESSES} addresses. Delete one first.`);
      }
      const makeDefault = isDefault || count === 0;
      if (makeDefault) await clearDefault(tx, userId);
      return tx.address.create({ data: { ...fields, userId, isDefault: makeDefault } });
    });
    return toAddress(row);
  }

  async update(userId: string, id: string, { isDefault, ...fields }: UpdateAddress): Promise<Address> {
    const row = await this.prisma.$transaction(async (tx) => {
      await this.find(tx, userId, id);
      // Unset the old default FIRST: the database allows only one at any moment
      if (isDefault) await clearDefault(tx, userId);
      return tx.address.update({ where: { id }, data: { ...fields, ...(isDefault ? { isDefault } : {}) } });
    });
    return toAddress(row);
  }

  // Deleting the default makes the newest remaining address the default
  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const address = await this.find(tx, userId, id);
      await tx.address.delete({ where: { id } });
      if (address.isDefault) {
        const next = await tx.address.findFirst({ where: { userId }, orderBy: { id: 'desc' } });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }

  private async find(db: Prisma.TransactionClient, userId: string, id: string): Promise<AddressRow> {
    const address = await db.address.findFirst({ where: { id, userId } });
    if (!address) throw new NotFoundException(NOT_FOUND);
    return address;
  }
}

const clearDefault = (tx: Prisma.TransactionClient, userId: string) =>
  tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });

export const toAddress = (a: AddressRow): Address => ({
  id: a.id,
  fullName: a.fullName,
  phone: a.phone,
  line1: a.line1,
  line2: a.line2,
  city: a.city,
  state: a.state,
  pincode: a.pincode,
  isDefault: a.isDefault,
});
