import { BadRequestException, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { IDEMPOTENCY_KEY_HEADER, idempotencyKeySchema } from '@shop/shared';
import type { Request } from 'express';

// `@IdempotencyKey() key: string`: the request's Idempotency-Key header, required and checked.
// (@Headers() can't take a schema, so this small decorator does the checking.)
// A missing or malformed key is 400, as the IETF Idempotency-Key draft says.
export const IdempotencyKey = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const value = context.switchToHttp().getRequest<Request>().get(IDEMPOTENCY_KEY_HEADER);
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException(
      value === undefined
        ? `This request needs an ${IDEMPOTENCY_KEY_HEADER} header (a new random value for each order).`
        : `The ${IDEMPOTENCY_KEY_HEADER} header ${parsed.error.issues[0]?.message ?? 'is invalid'}.`,
    );
  }
  return parsed.data;
});
