import type { NestExpressApplication } from '@nestjs/platform-express';
import { imageUploadSignatureSchema } from '@shop/shared';
import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { cloudinarySignature } from '../src/uploads/cloudinary-signature.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';
import { signUp } from './support/shopper.js';
import { CLOUDINARY_TEST_SECRET } from './test-env.js';

describe('Product photo uploads (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('an admin gets a signature that covers the allowed formats and the tag', async () => {
    const admin = await signUp(app, 'Meera');
    await prisma.user.update({ where: { id: admin.user.id }, data: { role: 'ADMIN' } });

    const before = Math.floor(Date.now() / 1000);
    const res = await admin.as('post', '/admin/uploads/image-signature').expect(200);
    const { uploadUrl, fields, expiresAt } = imageUploadSignatureSchema.parse(res.body);

    expect(uploadUrl).toBe('https://api.cloudinary.com/v1_1/shop-test/image/upload');
    expect(fields).toMatchObject({ api_key: '123456789012345', allowed_formats: 'jpg,png,webp,avif', tags: 'shop-nest-product' });
    expect(Number(fields.timestamp)).toBeGreaterThanOrEqual(before);
    expect(expiresAt).toBe(Number(fields.timestamp) + 3600);
    // What Cloudinary will check: everything but api_key and the signature itself, signed with the secret
    const { api_key: _key, signature, ...signed } = fields;
    expect(signature).toBe(cloudinarySignature(signed, CLOUDINARY_TEST_SECRET));
    // The secret itself is never sent
    expect(JSON.stringify(res.body)).not.toContain(CLOUDINARY_TEST_SECRET);
  });

  it('customers and visitors get no signature', async () => {
    const customer = await signUp(app, 'Arjun');
    await customer.as('post', '/admin/uploads/image-signature').expect(403);
    await request(app.getHttpServer()).post('/api/admin/uploads/image-signature').expect(401);
  });
});
