import request from "supertest";
import { createApp } from "../../src/api/app";

import { DatabaseConnection } from "../../src/database/database";

import { SubscriptionRepository } from "../../src/repositories/SubscriptionRepository";
import { InvoiceRepository } from "../../src/repositories/InvoiceRepository";
import { WebhookEventRepository } from "../../src/repositories/WebhookEventRepository";

import { SubscriptionService } from "../../src/services/SubscriptionService";
import { WebhookService } from "../../src/services/WebhookService";

import { SubscriptionController } from "../../src/controllers/SubscriptionController";
import { WebhookController } from "../../src/controllers/WebhookController";

import { MockPaymentProvider } from "../../src/providers/MockPaymentProvider";

import { SubscriptionApiClient } from "../clients/SubscriptionApiClient";
import { WebhookSimulator } from "../simulators/WebhookSimulator";



export class TestEnvironment {


    public db!: DatabaseConnection;


    public provider!: MockPaymentProvider;


    public subscriptionRepository!: SubscriptionRepository;


    public invoiceRepository!: InvoiceRepository;


    public webhookEventRepository!: WebhookEventRepository;


    public app: any;


    public apiClient!: SubscriptionApiClient;


    public webhookSimulator!: WebhookSimulator;




    setup(){


        this.db =
            new DatabaseConnection();



        const connection =
            this.db.getConnection();




        this.subscriptionRepository =
            new SubscriptionRepository(
                connection
            );




        this.invoiceRepository =
            new InvoiceRepository(
                connection
            );




        this.webhookEventRepository =
            new WebhookEventRepository(
                connection
            );




        this.provider =
            new MockPaymentProvider();




        const subscriptionService =
            new SubscriptionService(

                this.subscriptionRepository,

                this.invoiceRepository,

                this.provider

            );




        const subscriptionController =
            new SubscriptionController(
                subscriptionService
            );




        const webhookService =
            new WebhookService(

                this.webhookEventRepository,

                subscriptionService,
                this.invoiceRepository

            );




        const webhookController =
            new WebhookController(
                webhookService
            );




        this.app =
            createApp(

                subscriptionController,

                webhookController

            );




        this.apiClient =
            new SubscriptionApiClient(
                this.app
            );




        this.webhookSimulator =
            new WebhookSimulator(
                this.app
            );

    }





    api(){

        return request(this.app);

    }


}