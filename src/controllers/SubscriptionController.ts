import { Request, Response } from "express";
import { SubscriptionService } from "../services/SubscriptionService";


export class SubscriptionController {


    constructor(
        private service: SubscriptionService
    ) {}



    create = async (
        req: Request,
        res: Response
    ) => {

        try {


            const result =
                await this.service.createSubscription(
                    req.body
                );


            return res
                .status(201)
                .json(result);



        } catch(error:any){


            return res
                .status(400)
                .json({

                    error:
                        error.message

                });

        }

    };




    get = (
        req: Request,
        res: Response
    ) => {


        try {


            const id =
                String(req.params.id);



            return res
                .status(200)
                .json({

                    id

                });



        } catch(error:any){


            return res
                .status(400)
                .json({

                    error:
                        error.message

                });

        }

    };





    cancel = async (
        req:Request,
        res:Response
    ) => {


        try {


            const result =
                await this.service.cancelSubscription(

                    String(req.params.id)

                );



            return res
                .status(200)
                .json(result);



        } catch(error:any){


            return res
                .status(400)
                .json({

                    error:
                        error.message

                });

        }

    };


}