import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { SubscriptionService } from '../application/service';

export class TestHttpServer {
  readonly server: Server;
  constructor(private readonly service: SubscriptionService) {
    this.server = createServer((req, res) => this.handle(req, res));
  }
  listen(port = 0): Promise<{ port: number }> {
    return new Promise(resolve => this.server.listen(port, '127.0.0.1', () => { (this.server as any).unref?.(); resolve({ port: (this.server.address() as any).port }); }));
  }
  close(): Promise<void> { return new Promise(resolve => this.server.close(() => resolve())); }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const body = await this.readBody(req);
    let result: { status: number; body: any };
    if (req.method === 'POST' && url.pathname === '/subscriptions') {
      result = await this.service.create(body);
    } else if (req.method === 'GET' && url.pathname.startsWith('/subscriptions/')) {
      result = this.service.get(url.pathname.split('/')[2]);
    } else if (req.method === 'POST' && url.pathname.endsWith('/cancel')) {
      result = this.service.cancel(url.pathname.split('/')[2]);
    } else if (req.method === 'POST' && url.pathname.endsWith('/plan')) {
      result = this.service.changePlan(url.pathname.split('/')[2], body.plan);
    } else if (req.method === 'POST' && url.pathname === '/webhooks/payment-provider') {
      result = this.service.webhook(body.raw, req.headers['x-provider-signature'] as string | undefined);
    } else {
      result = { status: 404, body: { error: 'Not found' } };
    }
    res.statusCode = result.status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(result.body));
  }
  private readBody(req: IncomingMessage): Promise<any> {
    return new Promise(resolve => {
      let raw = '';
      req.on('data', chunk => raw += chunk);
      req.on('end', () => { try { resolve({ ...JSON.parse(raw || '{}'), raw }); } catch { resolve({ raw }); } });
    });
  }
}
