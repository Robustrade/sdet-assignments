package utils;

public class RetryUtils {

    public static void retry(Runnable r, int attempts) {
        int count = 0;
        while (count < attempts) {
            try {
                r.run();
                return;
            } catch (Exception e) {
                count++;
                if (count == attempts) throw e;
            }
        }
    }
}