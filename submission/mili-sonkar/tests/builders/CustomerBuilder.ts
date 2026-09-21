export interface Customer {
    id: string;
}

export class CustomerBuilder {
    private value: Customer = {
        id: `customer-${crypto.randomUUID()}`,
    };

    with(overrides: Partial<Customer>): this {
        this.value = { ...this.value, ...overrides };
        return this;
    }

    build(): Customer {
        return { ...this.value };
    }
}
