package assertions;

import org.testng.Assert;

public class TransferAssertions {

    public static void assertBalanceInvariant(
            int beforeSource,
            int beforeDest,
            int afterSource,
            int afterDest,
            int amount) {

        Assert.assertEquals(beforeSource - amount, afterSource);
        Assert.assertEquals(afterDest, beforeDest + amount);

        // 🔥 critical invariant
        Assert.assertEquals(
                beforeSource + beforeDest,
                afterSource + afterDest
        );
    }
}