const express=require('express');
const app=express();

app.use(express.json());

let transfers=[];

app.post('/transfers',(req,res)=>{

const key=req.headers['idempotency-key'];

if(req.body.amount<=0)
 return res.status(400).json({error:'Invalid amount'});

let existing=transfers.find(x=>x.key===key);

if(existing)
 return res.status(201).json(existing);

let transfer={
 transfer_id:'TRX_'+Date.now(),
 source_wallet_id:req.body.source_wallet_id,
 destination_wallet_id:req.body.destination_wallet_id,
 amount:req.body.amount,
 currency:req.body.currency,
 status:'COMPLETED',
 key:key
};

transfers.push(transfer);

res.status(201).json(transfer);

});


app.get('/transfers/:id',(req,res)=>{

let t=transfers.find(x=>x.transfer_id===req.params.id);

res.json(t);

});


app.listen(3000,'127.0.0.1',
()=>console.log('Wallet API running on port 3000'));