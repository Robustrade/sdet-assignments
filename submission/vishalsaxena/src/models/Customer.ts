
export interface Customer {
    id: string;
    email: string;
    createdAt?: string;
  }
  
  export function createCustomer(
    id: string,
    email: string
  ): Customer {
    if (!id.trim()) {
      throw new Error('Customer ID is required');
    }
  
    if (!email.trim() || !email.includes('@')) {
      throw new Error('A valid customer email is required');
    }
  
    return {
      id,
      email: email.toLowerCase().trim()
    };
  }
  