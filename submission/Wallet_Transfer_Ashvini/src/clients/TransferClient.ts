import {APIRequestContext} from '@playwright/test';

export class TransferClient {

 constructor(private request:APIRequestContext){}

 async createTransfer(payload:any,key:string){
   return this.request.post('/transfers',{
     headers:{
       'Idempotency-Key':key,
       'Content-Type':'application/json'
     },
     data:payload
   });
 }

}