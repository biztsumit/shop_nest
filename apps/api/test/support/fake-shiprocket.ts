import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

// A FAKE Shiprocket: the parts of its API the shop uses, on this machine, so tests run the real
// client (login, token, URLs, JSON) without an account or real parcels. Tests drive it through
// /__fake/* (e.g. "the courier scanned the parcel"), like the fake Razorpay.
//
// Started once by global-setup.ts, on FAKE_SHIPROCKET_PORT; test-env.ts points the API at it.

export const FAKE_SHIPROCKET_PORT = 4998;
export const FAKE_SHIPROCKET_EMAIL = 'api-user@shop.test';
export const FAKE_SHIPROCKET_PASSWORD = 'fake-shiprocket-password';
export const FAKE_SHIPROCKET_WEBHOOK_TOKEN = 'fake-courier-webhook-token-0123';

export type FakeRequest = { method: string; path: string; body: Record<string, unknown> };
type Tracking = { status: string; statusId?: number; activities: Array<{ date: string; activity: string; location?: string; label: string }> };

export const startFakeShiprocket = (): Promise<Server> => {
  let tokens = new Set<string>();
  let logins = 0;
  let next = 1000;
  let down = false;
  let requests: FakeRequest[] = [];
  // "the next call to this path fails with this message"
  let failures = new Map<string, string>();
  const orders = new Map<number, { shipmentId: number; cancelled: boolean }>();
  const tracking = new Map<string, Tracking>();

  const send = (res: ServerResponse, status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>) : {};
  };

  const server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://fake').pathname;
      const body = req.method === 'POST' ? await readJson(req) : {};

      // ----- Controls for tests -----
      if (path === '/__fake/reset') {
        tokens = new Set(); logins = 0; down = false; requests = []; failures = new Map(); orders.clear(); tracking.clear();
        return send(res, 200, {});
      }
      if (path === '/__fake/down') { down = Boolean(body.down); return send(res, 200, {}); }
      if (path === '/__fake/expire-tokens') { tokens = new Set(); return send(res, 200, {}); }
      if (path === '/__fake/fail') { failures.set(String(body.path), String(body.message)); return send(res, 200, {}); }
      if (path === '/__fake/track') { tracking.set(String(body.awb), body.tracking as Tracking); return send(res, 200, {}); }
      if (path === '/__fake/requests') return send(res, 200, { requests, logins });

      // ----- The Shiprocket API -----
      if (down) return send(res, 503, { message: 'Service Unavailable' });
      if (path === '/v1/external/auth/login') {
        if (body.email !== FAKE_SHIPROCKET_EMAIL || body.password !== FAKE_SHIPROCKET_PASSWORD) return send(res, 400, { message: 'Invalid email and password combination' });
        logins += 1;
        const token = `fake-token-${logins}`;
        tokens.add(token);
        return send(res, 200, { token, email: body.email });
      }
      const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      if (!tokens.has(token)) return send(res, 401, { message: 'Token has expired', status_code: 401 });
      requests.push({ method: req.method ?? 'GET', path, body });
      const failure = failures.get(path);
      if (failure) {
        failures.delete(path);
        return send(res, 422, { message: failure, status_code: 422 });
      }

      if (req.method === 'POST' && path === '/v1/external/orders/create/adhoc') {
        const items = body.order_items as unknown[] | undefined;
        if (!items?.length || !/^\d{6}$/.test(String(body.billing_pincode)) || !body.pickup_location) {
          return send(res, 422, { message: 'Oops! Invalid Data.', status_code: 422 });
        }
        const orderId = next++;
        const shipmentId = next++;
        orders.set(orderId, { shipmentId, cancelled: false });
        return send(res, 200, { order_id: orderId, shipment_id: shipmentId, status: 'NEW', status_code: 1, awb_code: '', courier_name: '' });
      }
      if (req.method === 'POST' && path === '/v1/external/courier/assign/awb') {
        const awb = `7799${String(body.shipment_id).padStart(8, '0')}`;
        return send(res, 200, { awb_assign_status: 1, response: { data: { awb_code: awb, courier_name: 'Delhivery Surface', courier_company_id: 12, shipment_id: body.shipment_id } } });
      }
      if (req.method === 'POST' && path === '/v1/external/courier/generate/pickup') {
        return send(res, 200, { pickup_status: 1, response: { pickup_scheduled_date: '2026-11-19 10:00:00' } });
      }
      if (req.method === 'POST' && path === '/v1/external/courier/generate/label') {
        return send(res, 200, { label_created: 1, label_url: `https://labels.fake/${(body.shipment_id as number[])[0]}.pdf` });
      }
      if (req.method === 'POST' && path === '/v1/external/orders/cancel') {
        for (const id of body.ids as number[]) {
          const order = orders.get(id);
          if (order) order.cancelled = true;
        }
        return send(res, 200, { message: 'Order cancelled successfully.' });
      }
      const track = path.match(/^\/v1\/external\/courier\/track\/awb\/(.+)$/);
      if (req.method === 'GET' && track) {
        const t = tracking.get(decodeURIComponent(track[1]!));
        if (!t) return send(res, 200, { tracking_data: { track_status: 0, shipment_status: 0, shipment_track: [], shipment_track_activities: null, error: 'Aahh! There is no activities found in our DB. Please have some patience it will be updated soon.' } });
        return send(res, 200, {
          tracking_data: {
            track_status: 1,
            shipment_status: t.statusId,
            shipment_track: [{ current_status: t.status, courier_name: 'Delhivery Surface' }],
            shipment_track_activities: t.activities.map((a) => ({ date: a.date, status: 'X', activity: a.activity, location: a.location ?? '', 'sr-status-label': a.label })),
            track_url: `https://shiprocket.co/tracking/${track[1]}`,
          },
        });
      }
      return send(res, 404, { message: `fake shiprocket: no route ${req.method} ${path}` });
    })().catch((err: unknown) => send(res, 500, { message: String(err) }));
  });
  return new Promise((resolve) => server.listen(FAKE_SHIPROCKET_PORT, '127.0.0.1', () => resolve(server)));
};

// Drives it from a test
const control = async <T>(path: string, body: object = {}): Promise<T> => {
  const res = await fetch(`http://127.0.0.1:${FAKE_SHIPROCKET_PORT}/__fake/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`fake shiprocket ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};

export const fakeShiprocket = {
  reset: () => control('reset'),
  setDown: (down: boolean) => control('down', { down }),
  expireTokens: () => control('expire-tokens'),
  failNext: (path: string, message: string) => control('fail', { path, message }),
  setTracking: (awb: string, tracking: Tracking) => control('track', { awb, tracking }),
  requests: () => control<{ requests: FakeRequest[]; logins: number }>('requests'),
};
