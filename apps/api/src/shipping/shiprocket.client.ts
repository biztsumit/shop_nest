import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.js';

// What we send to book a parcel (Shiprocket's field names; amounts in RUPEES, sizes in cm/kg)
export type ShiprocketOrderInput = {
  order_id: string;
  order_date: string;               // "2026-11-18 14:05"
  pickup_location: string;
  billing_customer_name: string;
  billing_last_name: string;
  billing_address: string;
  billing_address_2: string;
  billing_city: string;
  billing_pincode: string;
  billing_state: string;
  billing_country: 'India';
  billing_email: string;
  billing_phone: string;
  shipping_is_billing: true;
  order_items: Array<{ name: string; sku: string; units: number; selling_price: number; hsn: string }>;
  payment_method: 'COD' | 'Prepaid';
  sub_total: number;
  shipping_charges: number;
  transaction_charges: number;      // the cash-on-delivery fee
  total_discount: number;
  length: number;
  breadth: number;
  height: number;
  weight: number;
};

// One step of the journey, in a tracking answer or a webhook
export type ShiprocketScan = { date: string; status?: string; activity: string; location?: string; 'sr-status-label'?: string };

export type ShiprocketTracking = {
  tracking_data: {
    track_status: number;
    shipment_status?: number;
    shipment_track?: Array<{ current_status?: string; courier_name?: string }>;
    shipment_track_activities?: ShiprocketScan[] | null;
    track_url?: string;
    error?: string;
  };
};

// Talks to Shiprocket's API (https://apidocs.shiprocket.in) with plain fetch. Authentication:
// log in with an API user's email and password, get a token that works for 10 days, send it as
// "Authorization: Bearer ...". We keep it in memory and log in again when it's old or refused.
@Injectable()
export class ShiprocketClient {
  private readonly logger = new Logger(ShiprocketClient.name);
  private token: { value: string; until: number } | null = null;
  private loggingIn: Promise<string> | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  get enabled(): boolean {
    return Boolean(this.config.get('SHIPROCKET_EMAIL', { infer: true }));
  }

  get pickupLocation(): string {
    return this.config.get('SHIPROCKET_PICKUP_LOCATION', { infer: true });
  }

  // POST /orders/create/adhoc: tells Shiprocket about the order. Gives its order and shipment ids.
  async createOrder(input: ShiprocketOrderInput): Promise<{ orderId: string; shipmentId: string }> {
    const res = await this.call<{ order_id?: number; shipment_id?: number; message?: string }>('create order', 'POST', '/v1/external/orders/create/adhoc', input);
    if (!res.order_id || !res.shipment_id) throw this.refused('create order', res.message);
    return { orderId: String(res.order_id), shipmentId: String(res.shipment_id) };
  }

  // Picks a courier (the account's rules decide which) and gets the tracking number (AWB)
  async assignAwb(shipmentId: string): Promise<{ awb: string; courierName: string }> {
    const res = await this.call<{ awb_assign_status?: number; message?: string; response?: { data?: { awb_code?: string; courier_name?: string; awb_assign_error?: string } } }>(
      'assign a courier', 'POST', '/v1/external/courier/assign/awb', { shipment_id: Number(shipmentId) },
    );
    const data = res.response?.data;
    if (res.awb_assign_status !== 1 || !data?.awb_code) throw this.refused('assign a courier', data?.awb_assign_error ?? res.message);
    return { awb: data.awb_code, courierName: data.courier_name ?? 'Courier' };
  }

  // Asks the courier to come and collect the parcel
  async requestPickup(shipmentId: string): Promise<void> {
    const res = await this.call<{ pickup_status?: number; message?: string }>('request a pickup', 'POST', '/v1/external/courier/generate/pickup', { shipment_id: [Number(shipmentId)] });
    if (res.pickup_status !== 1) throw this.refused('request a pickup', res.message);
  }

  // The shipping label (a PDF on Shiprocket's servers) to print and stick on the parcel
  async label(shipmentId: string): Promise<string> {
    const res = await this.call<{ label_created?: number; label_url?: string; message?: string }>('make the label', 'POST', '/v1/external/courier/generate/label', { shipment_id: [Number(shipmentId)] });
    if (res.label_created !== 1 || !res.label_url) throw this.refused('make the label', res.message);
    return res.label_url;
  }

  // Calls the booking off (only works before the courier picks the parcel up)
  async cancel(orderId: string): Promise<void> {
    await this.call('cancel the shipment', 'POST', '/v1/external/orders/cancel', { ids: [Number(orderId)] });
  }

  track(awb: string): Promise<ShiprocketTracking> {
    return this.call('track the parcel', 'GET', `/v1/external/courier/track/awb/${encodeURIComponent(awb)}`);
  }

  // Webhooks carry the token we chose in the panel as the x-api-key header. Compared in constant
  // time (like the Razorpay signatures), so timing can't reveal it character by character.
  isValidWebhookToken(given: string | undefined): boolean {
    const expected = this.config.get('SHIPROCKET_WEBHOOK_TOKEN', { infer: true });
    if (!expected || !given) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // `what` names the step for error messages: "Shiprocket couldn't assign a courier: ..."
  private async call<T>(what: string, method: 'GET' | 'POST', path: string, body?: object, retried = false): Promise<T> {
    const token = await this.currentToken();
    let res: Response;
    try {
      res = await fetch(new URL(path, this.config.get('SHIPROCKET_API_URL', { infer: true })), {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      this.logger.error({ err, method, path }, 'Shiprocket unreachable');
      throw new BadGatewayException("Shiprocket isn't responding. Please try again in a moment.");
    }
    // The token expired or was revoked: log in again, once
    if (res.status === 401 && !retried) {
      this.token = null;
      return this.call(what, method, path, body, true);
    }
    const data = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (!res.ok) throw this.refused(what, data.message, res.status);
    return data;
  }

  private async currentToken(): Promise<string> {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    // Several requests at once share one login
    this.loggingIn ??= this.login().finally(() => (this.loggingIn = null));
    return this.loggingIn;
  }

  private async login(): Promise<string> {
    const email = this.config.get('SHIPROCKET_EMAIL', { infer: true });
    const password = this.config.get('SHIPROCKET_PASSWORD', { infer: true });
    if (!email || !password) throw new ServiceUnavailableException("Shipping with Shiprocket isn't set up on this shop.");
    let res: Response;
    try {
      res = await fetch(new URL('/v1/external/auth/login', this.config.get('SHIPROCKET_API_URL', { infer: true })), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      this.logger.error({ err }, 'Shiprocket unreachable');
      throw new BadGatewayException("Shiprocket isn't responding. Please try again in a moment.");
    }
    const data = (await res.json().catch(() => ({}))) as { token?: string; message?: string };
    if (!res.ok || !data.token) {
      this.logger.error({ status: res.status, message: data.message }, 'Shiprocket login failed');
      throw new BadGatewayException('Shiprocket refused the login. Check SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD (an API user).');
    }
    // Valid for 10 days; we use it for 9
    this.token = { value: data.token, until: Date.now() + 9 * 24 * 60 * 60 * 1000 };
    return data.token;
  }

  // Shiprocket's reasons are useful to the admin who clicked ("Delivery postcode not
  // serviceable", "Insufficient wallet balance"), and only admins book parcels: show them.
  private refused(what: string, message?: string, status?: number): BadGatewayException {
    this.logger.error({ what, status, message }, 'Shiprocket refused a request');
    return new BadGatewayException(`Shiprocket couldn't ${what}${message ? `: ${message}` : '.'}`);
  }
}
