import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

// A MODULE groups related providers and decides what other modules may use (exports).
// @Global(): imported once (in AppModule), PrismaService is then available everywhere,
// so feature modules don't each have to import PrismaModule.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
