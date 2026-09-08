import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, baseWebhook, sign } from '../testHelpers';

function createTrialSub(ctx:any){ return ctx.service.create({customerId:'cust_001',plan:'pro',paymentMethodId:'pm'}); }

test('covers trialing -> active via payment.succeeded with persistence and audit', async()=>{
 const ctx=createContext(); const c=await createTrialSub(ctx); const id=c.body.id; const payload=baseWebhook(id,{event_id:'evt_success',invoice_id:'inv_success'}); const raw=JSON.stringify(payload);
 assert.equal(ctx.service.webhook(raw,sign(raw)).status,200); assert.equal(ctx.repo.getSubscription(id)!.status,'active'); assert.equal(ctx.repo.getInvoice('inv_success')!.status,'succeeded'); assert.equal(ctx.repo.getWebhookEvent('evt_success')!.processed,true); assert.equal(ctx.repo.getAuditEvents(id).at(-1)?.toStatus,'active');
});

test('covers trialing -> past_due via payment.failed, then past_due -> active via retry success', async()=>{
 const ctx=createContext(); const c=await createTrialSub(ctx); const id=c.body.id;
 const fail=baseWebhook(id,{event_id:'evt_fail',type:'payment.failed',invoice_id:'inv_fail'}); let raw=JSON.stringify(fail); ctx.service.webhook(raw,sign(raw)); assert.equal(ctx.repo.getSubscription(id)!.status,'past_due'); assert.equal(ctx.repo.getInvoice('inv_fail')!.status,'failed');
 const retry=baseWebhook(id,{event_id:'evt_retry',type:'payment.succeeded',invoice_id:'inv_retry'}); raw=JSON.stringify(retry); ctx.service.webhook(raw,sign(raw)); assert.equal(ctx.repo.getSubscription(id)!.status,'active');
});

test('covers active -> past_due and past_due -> canceled using the service state-machine seam', async()=>{
 const ctx=createContext(); const c=await ctx.service.create({customerId:'cust_001',plan:'basic',paymentMethodId:'pm'}); const id=c.body.id; assert.equal(c.body.status,'active');
 const fail=baseWebhook(id,{event_id:'evt_rec_fail',type:'payment.failed',invoice_id:'inv_rec_fail',amount:1000}); const raw=JSON.stringify(fail); ctx.service.webhook(raw,sign(raw)); assert.equal(ctx.repo.getSubscription(id)!.status,'past_due');
 const sm=ctx.stateMachine; const canceled=sm.transition('past_due','retries_exhausted'); assert.equal(canceled,'canceled');
});

test('canceled subscription cannot be reactivated by payment.succeeded webhook', async()=>{
 const ctx=createContext(); const c=await ctx.service.create({customerId:'cust_001',plan:'pro',paymentMethodId:'pm'}); const id=c.body.id; ctx.service.cancel(id); const before=ctx.repo.countInvoices(id);
 const payload=baseWebhook(id,{event_id:'evt_after_cancel',invoice_id:'inv_after_cancel'}); const raw=JSON.stringify(payload); const r=ctx.service.webhook(raw,sign(raw)); assert.equal(r.body.ignored,true); assert.equal(ctx.repo.getSubscription(id)!.status,'canceled'); assert.equal(ctx.repo.countInvoices(id),before); assert.equal(ctx.repo.getWebhookEvent('evt_after_cancel')!.processed,true);
});

test('duplicate webhook is idempotent and produces no duplicate invoice', async()=>{
 const ctx=createContext(); const c=await createTrialSub(ctx); const id=c.body.id; const payload=baseWebhook(id,{event_id:'evt_dup',invoice_id:'inv_dup'}); const raw=JSON.stringify(payload); const first=ctx.service.webhook(raw,sign(raw)); const second=ctx.service.webhook(raw,sign(raw)); assert.equal(first.body.processed,true); assert.equal(second.body.duplicate,true); assert.equal(ctx.repo.countInvoices(id),1); assert.equal(ctx.repo.countWebhookEvents(id),1); assert.equal(ctx.repo.getSubscription(id)!.status,'active');
});

test('stale payment.failed for an already-successful invoice cannot regress active subscription', async()=>{
 const ctx=createContext(); const c=await createTrialSub(ctx); const id=c.body.id;
 const ok=baseWebhook(id,{event_id:'evt_ok',invoice_id:'inv_same',type:'payment.succeeded'}); let raw=JSON.stringify(ok); ctx.service.webhook(raw,sign(raw)); assert.equal(ctx.repo.getSubscription(id)!.status,'active');
 const late=baseWebhook(id,{event_id:'evt_late',invoice_id:'inv_same',type:'payment.failed'}); raw=JSON.stringify(late); const r=ctx.service.webhook(raw,sign(raw)); assert.equal(r.body.ignored,true); assert.equal(ctx.repo.getSubscription(id)!.status,'active'); assert.equal(ctx.repo.getInvoice('inv_same')!.status,'succeeded'); assert.equal(ctx.repo.countInvoices(id),1);
});

test('invalid transition is rejected structurally by state machine rather than status mutation',()=>{ const ctx=createContext(); assert.throws(()=>ctx.stateMachine.transition('canceled','retry_charge_succeeded')); assert.throws(()=>ctx.stateMachine.transition('active','retry_charge_succeeded')); });


test('payment.refunded updates an existing successful invoice without reactivating or charging', async()=>{
 const ctx=createContext(); const c=await createTrialSub(ctx); const id=c.body.id; const ok=baseWebhook(id,{event_id:'evt_ref_ok',invoice_id:'inv_ref',type:'payment.succeeded'}); let raw=JSON.stringify(ok); ctx.service.webhook(raw,sign(raw));
 const refund=baseWebhook(id,{event_id:'evt_refund',invoice_id:'inv_ref',type:'payment.refunded'}); raw=JSON.stringify(refund); const r=ctx.service.webhook(raw,sign(raw)); assert.equal(r.body.processed,true); assert.equal(ctx.repo.getInvoice('inv_ref')!.status,'refunded'); assert.equal(ctx.repo.getSubscription(id)!.status,'active');
});
