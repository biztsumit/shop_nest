import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

// "A UNIQUE rule said no" (P2002) on one of these columns → a friendly 409 instead of a 500.
// Letting the database decide is race-free; checking "is it taken?" first is not.
export const rethrowUnique = (err: unknown, messages: Record<string, string>): never => {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = JSON.stringify(err.meta ?? {});
    const hit = Object.entries(messages).find(([field]) => target.includes(field));
    throw new ConflictException(hit?.[1] ?? 'That already exists.');
  }
  throw err;
};
