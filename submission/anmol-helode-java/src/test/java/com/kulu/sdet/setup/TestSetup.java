package setup;

import org.testng.annotations.BeforeMethod;

public class TestSetup {

    @BeforeMethod
    public void reset() {
        // Optional: reset DB state
        // call SQL or API if available
    }
}