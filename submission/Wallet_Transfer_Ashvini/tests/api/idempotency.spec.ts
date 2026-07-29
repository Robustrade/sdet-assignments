import {test,expect} from '@playwright/test';
import {TransferClient} from '../../src/clients/TransferClient';
import {TransferBuilder} from '../../src/builders/TransferBuilder';

test('Duplicate request returns same transfer',async({request})=>{

 const client=new TransferClient(request);
 const key=`same-key-${crypto.randomUUID()}`;

 const first=await client.createTransfer(
  TransferBuilder.valid(),key
 );

 const second=await client.createTransfer(
  TransferBuilder.valid(),key
 );

 expect(second.status()).toBe(201);

 const a=await first.json();
 const b=await second.json();

 expect(a.transfer_id).toBe(b.transfer_id);

});