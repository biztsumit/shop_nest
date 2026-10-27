// Makes an existing account an admin:
//
//   npm run make-admin -w @shop/api -- riya@example.com
//
// Why a script? Nobody can sign up as an admin (the API ignores a "role" sent at sign-up), and
// only an admin can make other admins. The very first admin has to come from someone who can
// run commands on the server: that's the proof of being allowed to.
// After that, admins promote others through the API (PATCH /api/admin/users/:id/role).
import { pgAdapter } from '../src/prisma/adapter.js';
import { emailSchema } from '@shop/shared';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '../src/generated/prisma/client.js';

export type MakeAdminResult = 'promoted' | 'already-admin' | 'no-such-user';

export async function makeAdmin(prisma: PrismaClient, rawEmail: string): Promise<MakeAdminResult> {
  const email = emailSchema.parse(rawEmail);   // the same normalising as sign-up: " Riya@X.com" → "riya@x.com"
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return 'no-such-user';
  if (user.role === 'ADMIN') return 'already-admin';
  await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
  return 'promoted';
}

// Run directly (not when a test imports makeAdmin)
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const email = process.argv[2];
  const url = process.env.DATABASE_URL;
  if (!email || !url) {
    console.error('Usage: npm run make-admin -w @shop/api -- <email>   (DATABASE_URL comes from apps/api/.env)');
    process.exit(1);
  }
  const prisma = new PrismaClient({ adapter: pgAdapter(url) });
  try {
    const result = await makeAdmin(prisma, email);
    const database = new URL(url).pathname.slice(1);
    const messages: Record<MakeAdminResult, string> = {
      promoted: `${email} is now an admin (database "${database}"). They get admin access right away.`,
      'already-admin': `${email} was already an admin.`,
      'no-such-user': `No account with the email ${email}. Sign up first, then run this again.`,
    };
    console.log(messages[result]);
    process.exitCode = result === 'no-such-user' ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}
