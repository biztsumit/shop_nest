import type { INestApplication } from '@nestjs/common';
import { addressSchema, authResponseSchema } from '@shop/shared';
import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { catalogFixtures } from './catalog-fixtures.js';

let visitor = 0;

// A signed-up shopper with a helper to call the API as them
export const signUp = async (app: INestApplication, name = 'Riya') => {
  const http = () => request(app.getHttpServer());
  const res = await http().post('/api/auth/register').set('X-Forwarded-For', `192.0.2.${++visitor % 250}`)
    .send({ name, email: `${name.toLowerCase()}@example.com`, password: 'correct horse battery' }).expect(201);
  const { accessToken, user } = authResponseSchema.parse(res.body);
  const as = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body?: object, headers: Record<string, string> = {}) => {
    let req = http()[method](`/api${path}`).set('Authorization', `Bearer ${accessToken}`);
    for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
    return req.send(body);
  };
  const addAddress = async () =>
    addressSchema.parse((await as('post', '/addresses', {
      fullName: `${name} Sharma`, phone: '9876543210', line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001',
    }).expect(201)).body);
  return { user, accessToken, as, addAddress };
};

// An ACTIVE product with one variant; returns the variant's id
export const variantOf = async (prisma: PrismaClient, slug: string, opts: { stock?: number; price?: number } = {}) => {
  const product = await catalogFixtures(prisma).product(slug, {
    variants: [{ price: opts.price ?? 49900, stock: opts.stock ?? 5, sku: `${slug.toUpperCase()}-1` }],
    images: [`https://img.example.com/${slug}.jpg`],
  });
  return (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } })).id;
};

export const stockOf = async (prisma: PrismaClient, variantId: string) =>
  (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stock;
