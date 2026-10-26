import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { createAddressSchema, updateAddressSchema, type Address, type CreateAddress, type UpdateAddress } from '@shop/shared';
import { z } from 'zod';
import { Auth } from '../auth/auth.decorator.js';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AddressesService } from './addresses.service.js';

// The logged-in user's delivery addresses
@Auth()
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<Address[]> {
    return this.addresses.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body({ schema: createAddressSchema }) body: CreateAddress): Promise<Address> {
    return this.addresses.create(user.id, body);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', { schema: z.uuid() }) id: string): Promise<Address> {
    return this.addresses.get(user.id, id);
  }

  // PATCH /api/addresses/:id  { city: "Pune" } or { isDefault: true }
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: z.uuid() }) id: string,
    @Body({ schema: updateAddressSchema }) body: UpdateAddress,
  ): Promise<Address> {
    return this.addresses.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', { schema: z.uuid() }) id: string): Promise<void> {
    return this.addresses.remove(user.id, id);
  }
}
