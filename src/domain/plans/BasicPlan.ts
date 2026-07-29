import { PlanStrategy } from "./PlanStrategy";


export class BasicPlan implements PlanStrategy {


    getName(): string {
        return "basic";
    }


    getPrice(): number {
        return 1000;
    }


    getTrialDays(): number {
        return 14;
    }

}