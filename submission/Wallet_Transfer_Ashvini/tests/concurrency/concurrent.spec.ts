import {test,expect} from '@playwright/test';

test('Concurrent duplicate requests handled safely',async({request})=>{

 const payload={
 source_wallet_id:'wallet_001',
 destination_wallet_id:'wallet_002',
 amount:100,
 currency:'AED'
 };

 const key='concurrent-key';

 const result=await Promise.all([
 request.post('/transfers',{
  headers:{'Idempotency-Key':key},
  data:payload
 }),
 request.post('/transfers',{
  headers:{'Idempotency-Key':key},
  data:payload
 })
 ]);

 expect(result[0].status()).toBe(201);
 expect(result[1].status()).toBe(201);

});