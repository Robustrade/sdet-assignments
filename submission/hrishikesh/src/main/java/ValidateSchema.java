/**
 * CI-compatibility shim. The GitHub Actions Java workflow (see
 * .github/workflows/sdet-pr-checks-java.yml) probes for {@code src/main/java/ValidateSchema.java}
 * and runs {@code mvn exec:java -Dexec.mainClass="ValidateSchema"}. This shim delegates to the
 * packaged implementation in {@link com.kulu.sdet.ValidateSchema}.
 */
public class ValidateSchema {
  public static void main(String[] args) throws Exception {
    com.kulu.sdet.ValidateSchema.main(args);
  }
}
