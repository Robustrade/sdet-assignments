import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext } from '../testHelpers';

test('provider decline moves trial subscription to past_due and persists failed invoice', async()=>{const ctx=createContext();ctx.provider.setOutcome('decline');const r=await ctx.service.create({customerId:'cust_001',plan:'basic',paymentMethodId:'pm'});assert.equal(r.status,201);assert.equal(r.body.status,'past_due');assert.equal(ctx.provider.calls.length,1);assert.equal(ctx.repo.countInvoices(r.body.id),1);assert.equal(ctx.repo.findInvoiceBySubscription(r.body.id)!.status,'failed');});

test('provider timeout returns 504 and does not persist a phantom invoice', async()=>{const ctx=createContext();ctx.provider.setOutcome('timeout');const r=await ctx.service.create({customerId:'cust_001',plan:'basic',paymentMethodId:'pm'});assert.equal(r.status,504);assert.equal(ctx.provider.calls.length,1);assert.equal(ctx.repo.countInvoices(),0);});

test('replayed webhook never calls payment provider', async()=>{const ctx=createContext();const c=await ctx.service.create({customerId:'cust_001',plan:'pro',paymentMethodId:'pm'});const p={event_id:'evt_replay',type:'payment.succeeded',subscription_id:c.body.id,invoice_id:'inv_replay',amount:4900,currency:'USD'};const raw=JSON.stringify(p);const {sign}=await import('../testHelpers');ctx.service.webhook(raw,sign(raw));ctx.service.webhook(raw,sign(raw));assert.equal(ctx.provider.calls.length,0);});
