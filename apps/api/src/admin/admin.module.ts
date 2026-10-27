import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { AdminCatalogController } from './admin-catalog.controller.js';
import { AdminCatalogService } from './admin-catalog.service.js';
import { AdminCouponsController } from './admin-coupons.controller.js';
import { AdminCouponsService } from './admin-coupons.service.js';
import { AdminOrdersController } from './admin-orders.controller.js';
import { AdminOrdersService } from './admin-orders.service.js';
import { AdminReportsController } from './admin-reports.controller.js';
import { AdminReportsService } from './admin-reports.service.js';
import { AdminReviewsController } from './admin-reviews.controller.js';

// The shop's back office. Every route is @Auth('ADMIN') (role checked in the database).
// (Users and refunds have their admin routes in their own modules.)
@Module({
  imports: [AuthModule, OrdersModule],
  controllers: [AdminCatalogController, AdminOrdersController, AdminCouponsController, AdminReviewsController, AdminReportsController],
  providers: [AdminCatalogService, AdminOrdersService, AdminCouponsService, AdminReportsService],
})
export class AdminModule {}
