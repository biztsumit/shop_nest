import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

// A FAKE Razorpay: the same HTTP API (the parts the shop uses), running on this machine, so
// tests exercise the real client code (URLs, auth header, JSON) without real keys or money.
// Tests control it through /__fake/* endpoints, e.g. "the shopper paid in the Checkout popup".
//
// Started once by global-setup.ts, on FAKE_RAZORPAY_PORT; test-env.ts points the API at it.

export const FAKE_RAZORPAY_PORT = 4999;
export const FAKE_KEY_ID = 'rzp_test_fakekey000000';
export const FAKE_KEY_SECRET = 'fake-secret-for-tests-only';
export const FAKE_WEBHOOK_SECRET = 'fake-webhook-secret-for-tests';

type FakeOrder = { id: string; amount: number; currency: string; receipt: string; status: string; notes: object };
type FakePayment = {
  id: string; order_id: string; amount: number; currency: string; status: string; method: string;
  amount_refunded: number; captured: boolean; error_description: string | null;
};

export const startFakeRazorpay = (): Promise<Server> => {
  const orders = new Map<string, FakeOrder>();
  const payments = new Map<string, FakePayment>();
  let down = false;
  const id = (prefix: string) => `${prefix}_${randomBytes(7).toString('hex')}`;

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  };
  const fail = (res: ServerResponse, status: number, description: string) =>
    send(res, status, { error: { code: 'BAD_REQUEST_ERROR', description } });

  const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>) : {};
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const body = req.method === 'POST' ? await readJson(req) : {};
      const path = url.pathname;

      // ----- Controls for tests -----
      if (path === '/__fake/reset') {
        orders.clear(); payments.clear(); down = false;
        return send(res, 200, {});
      }
      if (path === '/__fake/down') {
        down = Boolean(body.down);
        return send(res, 200, {});
      }
      // "The shopper paid in the Checkout popup": makes a payment and the signature Checkout
      // would hand the browser
      if (path === '/__fake/pay') {
        const order = orders.get(String(body.order_id));
        if (!order) return fail(res, 404, 'no such order');
        const status = typeof body.status === 'string' ? body.status : 'captured';
        const payment: FakePayment = {
          id: id('pay'), order_id: order.id, amount: Number(body.amount ?? order.amount), currency: 'INR', status,
          method: 'upi', amount_refunded: 0, captured: status === 'captured', error_description: status === 'failed' ? 'Payment declined by bank' : null,
        };
        payments.set(payment.id, payment);
        if (status === 'captured') order.status = 'paid';
        const signature = createHmac('sha256', FAKE_KEY_SECRET).update(`${order.id}|${payment.id}`).digest('hex');
        return send(res, 200, { payment, signature });
      }
      if (path === '/__fake/payments') {
        return send(res, 200, [...payments.values()]);
      }

      // ----- The Razorpay API -----
      if (down) return fail(res, 503, 'service unavailable');
      const expected = `Basic ${Buffer.from(`${FAKE_KEY_ID}:${FAKE_KEY_SECRET}`).toString('base64')}`;
      if (req.headers.authorization !== expected) return fail(res, 401, 'Authentication failed');

      let match: RegExpExecArray | null;
      if (req.method === 'POST' && path === '/v1/orders') {
        if (!Number.isInteger(body.amount) || Number(body.amount) < 100) return fail(res, 400, 'amount must be at least 100 paise');
        const order: FakeOrder = { id: id('order'), amount: Number(body.amount), currency: String(body.currency), receipt: String(body.receipt), status: 'created', notes: (body.notes as object) ?? {} };
        orders.set(order.id, order);
        return send(res, 200, order);
      }
      if (req.method === 'GET' && (match = /^\/v1\/orders\/([^/]+)\/payments$/.exec(path))) {
        const items = [...payments.values()].filter((p) => p.order_id === match![1]);
        return send(res, 200, { entity: 'collection', count: items.length, items });
      }
      if (req.method === 'GET' && (match = /^\/v1\/payments\/([^/]+)$/.exec(path))) {
        const payment = payments.get(match[1]!);
        return payment ? send(res, 200, payment) : fail(res, 404, 'The id provided does not exist');
      }
      if (req.method === 'POST' && (match = /^\/v1\/payments\/([^/]+)\/capture$/.exec(path))) {
        const payment = payments.get(match[1]!);
        if (!payment || payment.status !== 'authorized') return fail(res, 400, 'This payment has already been captured');
        if (Number(body.amount) !== payment.amount) return fail(res, 400, 'Capture amount must be equal to the amount authorized');
        Object.assign(payment, { status: 'captured', captured: true });
        return send(res, 200, payment);
      }
      if (req.method === 'POST' && (match = /^\/v1\/payments\/([^/]+)\/refund$/.exec(path))) {
        const payment = payments.get(match[1]!);
        const amount = Number(body.amount ?? payment?.amount);
        if (!payment || !payment.captured) return fail(res, 400, 'The payment has not been captured');
        if (payment.amount_refunded + amount > payment.amount) return fail(res, 400, 'The refund amount is greater than the refundable amount');
        payment.amount_refunded += amount;
        if (payment.amount_refunded === payment.amount) payment.status = 'refunded';
        return send(res, 200, { id: id('rfnd'), entity: 'refund', payment_id: payment.id, amount, status: 'processed' });
      }
      return fail(res, 404, `no route ${req.method} ${path}`);
    })();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(FAKE_RAZORPAY_PORT, '127.0.0.1', () => resolve(server));
  });
};
