import Database from "better-sqlite3";


export class InvoiceRepository {

  constructor(
    private db: Database.Database
  ) {}


  create(invoice:{
    id:string;
    subscriptionId:string;
    amount:number;
    status:string;
    createdAt:string;
  }):void {


    this.db.prepare(`
      INSERT INTO invoices
      (
        id,
        subscription_id,
        amount,
        status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      invoice.id,
      invoice.subscriptionId,
      invoice.amount,
      invoice.status,
      invoice.createdAt
    );
  }


  findBySubscription(
    subscriptionId:string
  ) {

    return this.db.prepare(`
      SELECT *
      FROM invoices
      WHERE subscription_id = ?
    `)
    .all(subscriptionId);

  }

}