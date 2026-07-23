export class TransferBuilder{

 static valid(){
  return {
   source_wallet_id:'wallet_001',
   destination_wallet_id:'wallet_002',
   amount:1000,
   currency:'AED',
   reference:'invoice001'
  };
 }

}