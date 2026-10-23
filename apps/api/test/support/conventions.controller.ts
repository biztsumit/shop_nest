import { Body, Controller, Get, NotFoundException, Post } from '@nestjs/common';
import { z } from 'zod';

// Endpoints that exist ONLY in the tests, to trigger each kind of response on purpose.
// They're added to the test app next to the real AppModule, never to the real app.
export const signupSchema = z.object({
  name: z.string().trim().min(2),
  age: z.coerce.number().int().positive(),
  address: z.object({ postalCode: z.string().regex(/^\d{6}$/, 'must be 6 digits') }),
});

@Controller('test')
export class ConventionsTestController {
  @Post('echo')
  echo(@Body({ schema: signupSchema }) body: z.infer<typeof signupSchema>) {
    return body;
  }

  @Get('missing')
  missing(): never {
    throw new NotFoundException('That product no longer exists');
  }

  @Get('boom')
  boom(): never {
    throw new Error('database password is hunter2');
  }
}
