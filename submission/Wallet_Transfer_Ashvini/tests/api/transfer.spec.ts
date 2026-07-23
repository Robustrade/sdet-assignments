import {test,expect} from '@playwright/test';
import {TransferClient} from '../../src/clients/TransferClient';
import {TransferBuilder} from '../../src/builders/TransferBuilder';

test('Successful wallet transfer', async({request})=>{

 const client=new TransferClient(request);

 const response=await client.createTransfer(
   TransferBuilder.valid(),
   crypto.randomUUID()
 );

 expect(response.status()).toBe(201);

 const body=await response.json();

 expect(body.status).toBe('COMPLETED');

});