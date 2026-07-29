import { PlanStrategy } from "./PlanStrategy";
import { BasicPlan } from "./BasicPlan";
import { ProPlan } from "./ProPlan";


export class PlanFactory {


    static create(plan:string):PlanStrategy {


        switch(plan){

            case "basic":
                return new BasicPlan();


            case "pro":
                return new ProPlan();


            default:
                throw new Error(
                    "Unsupported plan"
                );
        }

    }

}