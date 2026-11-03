type LogLevel = "INFO" | "WARN" | "ERROR";

function log(level: LogLevel, message: string): void {
  const timestamp = new Date().toISOString();

  console.log(`[${timestamp}] [${level}] ${message}`);
}

export const logger = {
  info(message: string): void {
    log("INFO", message);
  },

  warn(message: string): void {
    log("WARN", message);
  },

  error(message: string): void {
    log("ERROR", message);
  }
};
