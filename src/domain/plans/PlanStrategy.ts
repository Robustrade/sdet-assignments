export interface PlanStrategy {

    getName(): string;

    getPrice(): number;

    getTrialDays(): number;

}