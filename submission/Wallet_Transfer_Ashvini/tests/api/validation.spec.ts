import {test,expect} from '@playwright/test';

test('Invalid amount rejected',async({request})=>{

 const response=await request.post('/transfers',{
 data:{
  source_wallet_id:'wallet_001',
  destination_wallet_id:'wallet_002',
  amount:-100,
  currency:'AED'
 }
 });

 expect(response.status()).toBe(400);

});