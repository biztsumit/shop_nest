import { HttpStatus, StandardSchemaValidationPipe, UnprocessableEntityException } from '@nestjs/common';
import type { FieldError } from '@shop/shared';

// Thrown when input doesn't match its schema. Carries one message per invalid field, which
// the problem filter sends back as `errors`, so the web app can show each message under its field.
export class ValidationFailedException extends UnprocessableEntityException {
  constructor(readonly fieldErrors: FieldError[]) {
    super(fieldErrors.length === 1 ? '1 field is invalid' : `${fieldErrors.length} fields are invalid`);
  }
}

// A "Standard Schema" issue (zod and other libraries produce these): a message, and the path
// to the value, made of keys or { key } objects. ["items", 2, "quantity"] → "items.2.quantity"
type Issue = { message: string; path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> };

const pathOf = (issue: Issue): string =>
  (issue.path ?? []).map((part) => String(typeof part === 'object' ? part.key : part)).join('.');

// Nest 12's built-in pipe validates any parameter declared with a schema:
//   @Body({ schema: createProductSchema }) body: CreateProduct
// The schemas come from @shop/shared, so the API and the web app check input with the SAME rules.
export const validationPipe = (): StandardSchemaValidationPipe =>
  new StandardSchemaValidationPipe({
    // 422: the request was understood, but its content is invalid (400 is for unreadable requests)
    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    exceptionFactory: (issues: readonly Issue[]) =>
      new ValidationFailedException(issues.map((issue) => ({ path: pathOf(issue), message: issue.message }))),
  });
