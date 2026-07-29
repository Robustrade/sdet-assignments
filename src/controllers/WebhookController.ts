import { Request, Response } from "express";
import { WebhookService } from "../services/WebhookService";


export class WebhookController {


    constructor(
        private service: WebhookService
    ) {}



    handle = async(
        req: Request,
        res: Response
    ) => {


        try {


            const result =
                await this.service.process(
                    req.body
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