export class SignatureValidator {

  validate(
    signature?: string
  ): boolean {

    return (
      signature ===
      "valid-signature"
    );

  }

}