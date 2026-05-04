package setup;

import org.testng.annotations.BeforeMethod;

public class TestSetup {

    @BeforeMethod
    public void setup() throws Exception {
        DbUtils.resetBalances();
    }
}