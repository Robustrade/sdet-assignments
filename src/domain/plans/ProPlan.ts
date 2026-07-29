import { PlanStrategy } from "./PlanStrategy";


export class ProPlan implements PlanStrategy {


    getName(): string {
        return "pro";
    }


    getPrice(): number {
        return 4900;
    }


    getTrialDays(): number {
        return 7;
    }

}