export class DataGenerator {
  static randomString(length = 8): string {
    const characters =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    let result = '';

    for (let i = 0; i < length; i++) {
      result += characters.charAt(
        Math.floor(Math.random() * characters.length)
      );
    }

    return result;
  }

  static randomEmail(): string {
    return `test_${Date.now()}_${this.randomString(5)}@example.com`;
  }

  static randomName(): string {
    return `Test User ${this.randomString(5)}`;
  }

  static randomAmount(min = 10, max = 1000): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
