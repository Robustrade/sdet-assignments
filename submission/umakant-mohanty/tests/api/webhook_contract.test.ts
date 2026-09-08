import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TestContext } from '../../src/application/testContext';
import { TestHttpServer } from '../../src/api/httpServer';
import { WebhookBuilder } from '../../src/builders/testDataBuilders';

const ctx = new TestContext(); const http = new TestHttpServer(ctx.service); let base=''; let subId='';
before(async()=>{ctx.reset();base=`http://127.0.0.1:${(await http.listen()).port}`;const c=await ctx.service.create({customerId:'cust_001',plan:'pro',paymentMethodId:'pm'});subId=c.body.id;});
after(async()=>{await http.close();});
async function post(payloadText:string, signature?:string){const r=await fetch(base+'/webhooks/payment-provider',{method:'POST',headers:{'content-type':'application/json',connection:'close',...(signature?{'x-provider-signature':signature}:{})},body:payloadText});return {status:r.status,body:await r.json()};}

test('rejects missing and forged webhook signatures before business processing',async()=>{ctx.reset();const c=await ctx.service.create({customerId:'cust_001',plan:'pro',paymentMethodId:'pm'});subId=c.body.id;const body=JSON.stringify(new WebhookBuilder().withSubscription(subId).build());assert.equal((await post(body)).status,401);assert.equal((await post(body,'bad')).status,401);assert.equal(ctx.repo.countWebhookEvents(),0);});
test('rejects malformed JSON and malformed payload',async()=>{ctx.reset();const c=await ctx.service.create({customerId:'cust_001',plan:'pro',paymentMethodId:'pm'});subId=c.body.id;assert.equal((await post('{bad','x')).status,401);const payload={event_id:'evt_bad',type:'payment.succeeded',subscription_id:subId};const raw=JSON.stringify(payload);const b=new WebhookBuilder();const sig=b.sign('test-secret',payload as any);assert.equal((await post(raw,sig)).status,400);});
