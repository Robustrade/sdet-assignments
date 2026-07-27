import {
    PaymentProvider,
    ChargeRequest,
    ChargeResponse
} from "./PaymentProvider";


export class MockPaymentProvider 
implements PaymentProvider {


    public calls: ChargeRequest[] = [];


    private response: ChargeResponse = {
        success:true,
        transactionId:"txn_test_001"
    };


    setResponse(
        response:ChargeResponse
    ){

        this.response = response;

    }


    async charge(
        request:ChargeRequest
    ):Promise<ChargeResponse>{


        this.calls.push(request);


        return this.response;

    }


    getCallCount():number{

        return this.calls.length;

    }


    getLastRequest():ChargeRequest | undefined{

        return this.calls[
            this.calls.length - 1
        ];

    }

}