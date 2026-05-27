import { performance } from "perf_hooks";

export interface LogLevel {
  SILENT: -1;
  ERROR: 0;
  WARN: 1;
  INFO: 2;
  DEBUG: 3;
  TRACE: 4;
}

export const LOG_LEVELS: LogLevel = {
  SILENT: -1,
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4,
};

export interface LoggerConfig {
  level: keyof LogLevel;
  verbose: boolean;
  showTimestamps: boolean;
  showProgress: boolean;
  useColors: boolean;
}

export interface ProgressInfo {
  current: number;
  total: number;
  label: string;
  percentage: number;
}

export interface ValidationSummary {
  filesProcessed: number;
  schemasFound: number;
  endpointsFound: number;
  pathsFound: number;
  componentsFound: number;
  callbacksFound: number;
  webhooksFound: number;
  referencesFound: number;
  circularReferences: number;
  validationErrors: number;
  validationWarnings: number;
  processingTime: number;
}

export class Logger {
  private config: LoggerConfig;
  private startTime: number;
  private operationStartTime: number;
  private currentProgress: ProgressInfo | null = null;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: "WARN",
      verbose: false,
      showTimestamps: true,
      showProgress: true,
      useColors: true,
      ...config,
    };
    this.startTime = performance.now();
    this.operationStartTime = this.startTime;
  }

  private getTimestamp(): string {
    if (!this.config.showTimestamps) return "";
    const now = new Date();
    const timeString = now.toISOString().split("T")[1];
    if (!timeString) return "";
    const timePart = timeString.split(".")[0];
    return `[${timePart}] `;
  }

  private getColorCode(level: keyof LogLevel): string {
    if (!this.config.useColors) return "";

    const colors = {
      SILENT: "",
      ERROR: "\x1b[31m", // Red
      WARN: "\x1b[33m", // Yellow
      INFO: "\x1b[36m", // Cyan
      DEBUG: "\x1b[35m", // Magenta
      TRACE: "\x1b[90m", // Gray
    };

    return colors[level] || "";
  }

  private getResetColor(): string {
    return this.config.useColors ? "\x1b[0m" : "";
  }

  private shouldLog(level: keyof LogLevel): boolean {
    if (this.config.level === "SILENT") return false;
    return LOG_LEVELS[level] <= LOG_LEVELS[this.config.level];
  }

  private formatMessage(
    level: keyof LogLevel,
    message: string,
    data?: any
  ): string {
    const timestamp = this.getTimestamp();
    const color = this.getColorCode(level);
    const reset = this.getResetColor();
    const levelStr = level.padEnd(5);

    let formatted = `${timestamp}${color}${levelStr}${reset} ${message}`;

    if (data && this.config.verbose) {
      formatted += `\n${JSON.stringify(data, null, 2)}`;
    }

    return formatted;
  }

  private log(level: keyof LogLevel, message: string, data?: any): void {
    if (!this.shouldLog(level)) return;

    const formatted = this.formatMessage(level, message, data);
    process.stderr.write(`${formatted}\n`);
  }

  public error(message: string, data?: any): void {
    this.log("ERROR", message, data);
  }

  public warn(message: string, data?: any): void {
    this.log("WARN", message, data);
  }

  public info(message: string, data?: any): void {
    this.log("INFO", message, data);
  }

  public debug(message: string, data?: any): void {
    this.log("DEBUG", message, data);
  }

  public trace(message: string, data?: any): void {
    this.log("TRACE", message, data);
  }

  public startOperation(operation: string): void {
    this.operationStartTime = performance.now();
    this.info(`🚀 Starting ${operation}`);
  }

  public endOperation(operation: string, success: boolean = true): void {
    const duration = performance.now() - this.operationStartTime;
    const status = success ? "✅" : "❌";
    this.info(`${status} Completed ${operation} in ${duration.toFixed(2)}ms`);
  }

  public startProgress(total: number, label: string): void {
    this.currentProgress = {
      current: 0,
      total,
      label,
      percentage: 0,
    };
    this.updateProgress(0);
  }

  public updateProgress(current: number): void {
    if (!this.currentProgress) return;

    this.currentProgress.current = current;
    this.currentProgress.percentage = Math.round(
      (current / this.currentProgress.total) * 100
    );
    this.renderProgress();
  }

  private renderProgress(): void {
    if (!this.currentProgress || !this.config.showProgress) return;

    const { current, total, label, percentage } = this.currentProgress;
    const barLength = 20;
    const filledLength = Math.round((percentage / 100) * barLength);
    const bar = "█".repeat(filledLength) + "░".repeat(barLength - filledLength);

    process.stderr.write(
      `\r${this.getTimestamp()}${this.getColorCode(
        "INFO"
      )}PROGRESS${this.getResetColor()} ${label}: [${bar}] ${percentage}% (${current}/${total})`
    );

    if (current >= total) {
      process.stderr.write("\n");
      this.currentProgress = null;
    }
  }

  public endProgress(): void {
    if (this.currentProgress) {
      this.updateProgress(this.currentProgress.total);
    }
  }

  public step(step: string, details?: string): void {
    const detailsStr = details ? ` - ${details}` : "";
    this.info(`📋 ${step}${detailsStr}`);
  }

  public fileOperation(
    operation: string,
    filePath: string,
    details?: string
  ): void {
    const detailsStr = details ? ` (${details})` : "";
    this.info(`📁 ${operation}: ${filePath}${detailsStr}`);
  }

  public parsingStep(step: string, details?: string): void {
    const detailsStr = details ? ` - ${details}` : "";
    this.info(`🔍 Parsing: ${step}${detailsStr}`);
  }

  public validationStep(step: string, details?: string): void {
    const detailsStr = details ? ` - ${details}` : "";
    this.info(`✅ Validation: ${step}${detailsStr}`);
  }

  public referenceStep(step: string, refPath: string, details?: string): void {
    const detailsStr = details ? ` - ${details}` : "";
    this.info(`🔗 Reference: ${step} ${refPath}${detailsStr}`);
  }

  public schemaStep(step: string, schemaName: string, details?: string): void {
    const detailsStr = details ? ` - ${details}` : "";
    this.info(`📋 Schema: ${step} ${schemaName}${detailsStr}`);
  }

  public endpointStep(
    step: string,
    method: string,
    path: string,
    details?: string
  ): void {
    const detailsStr = details ? ` - ${details}` : "";
    this.info(
      `🌐 Endpoint: ${step} ${method.toUpperCase()} ${path}${detailsStr}`
    );
  }

  public componentStep(
    step: string,
    componentType: string,
    componentName: string,
    details?: string
  ): void {
    const detailsStr = details ? ` - ${details}` : "";
    this.info(
      `🧩 Component: ${step} ${componentType} ${componentName}${detailsStr}`
    );
  }

  public webhookStep(
    step: string,
    webhookName: string,
    details?: string
  ): void {
    const detailsStr = details ? ` - ${details}` : "";
    this.info(`🎣 Webhook: ${step} ${webhookName}${detailsStr}`);
  }

  public callbackStep(
    step: string,
    callbackName: string,
    details?: string
  ): void {
    const detailsStr = details ? ` - ${details}` : "";
    this.info(`🔄 Callback: ${step} ${callbackName}${detailsStr}`);
  }

  public summary(summary: ValidationSummary): void {
    const duration = performance.now() - this.startTime;

    this.info("📊 Validation Summary");
    this.info("=".repeat(50));
    this.info(`Files Processed: ${summary.filesProcessed}`);
    this.info(`Schemas Found: ${summary.schemasFound}`);
    this.info(`Endpoints Found: ${summary.endpointsFound}`);
    this.info(`Paths Found: ${summary.pathsFound}`);
    this.info(`Components Found: ${summary.componentsFound}`);
    this.info(`Callbacks Found: ${summary.callbacksFound}`);
    this.info(`Webhooks Found: ${summary.webhooksFound}`);
    this.info(`References Found: ${summary.referencesFound}`);
    this.info(`Circular References: ${summary.circularReferences}`);
    this.info(`Validation Errors: ${summary.validationErrors}`);
    this.info(`Validation Warnings: ${summary.validationWarnings}`);
    this.info(`Total Processing Time: ${duration.toFixed(2)}ms`);
    this.info("=".repeat(50));
  }

  public detailedSummary(spec: any, version: string): void {
    this.info("📋 Detailed Specification Summary");
    this.info("=".repeat(50));

    // Basic info
    this.info(`OpenAPI Version: ${version}`);
    this.info(`Title: ${spec.info?.title || "N/A"}`);
    this.info(`Version: ${spec.info?.version || "N/A"}`);
    this.info(`Description: ${spec.info?.description || "N/A"}`);

    // Paths analysis
    if (spec.paths) {
      const paths = Object.keys(spec.paths);
      this.info(`Total Paths: ${paths.length}`);

      let totalEndpoints = 0;
      const methods = new Set<string>();

      for (const path of paths) {
        const pathItem = spec.paths[path];
        if (typeof pathItem === "object" && pathItem !== null) {
          for (const [method, operation] of Object.entries(pathItem)) {
            if (
              typeof operation === "object" &&
              operation !== null &&
              "responses" in operation
            ) {
              totalEndpoints++;
              methods.add(method.toUpperCase());
            }
          }
        }
      }

      this.info(`Total Endpoints: ${totalEndpoints}`);
      this.info(`HTTP Methods Used: ${Array.from(methods).join(", ")}`);
    }

    // Components analysis
    if (spec.components) {
      this.info("Components Analysis:");
      for (const [componentType, components] of Object.entries(
        spec.components
      )) {
        if (typeof components === "object" && components !== null) {
          const componentCount = Object.keys(components).length;
          this.info(`  ${componentType}: ${componentCount}`);
        }
      }
    }

    // Security analysis
    if (spec.security) {
      this.info(`Security Requirements: ${spec.security.length}`);
    }

    if (spec.components?.securitySchemes) {
      const securitySchemes = Object.keys(spec.components.securitySchemes);
      this.info(`Security Schemes: ${securitySchemes.length}`);
    }

    // Servers analysis
    if (spec.servers) {
      this.info(`Servers: ${spec.servers.length}`);
    }

    // Tags analysis
    if (spec.tags) {
      this.info(`Tags: ${spec.tags.length}`);
    }

    // External docs
    if (spec.externalDocs) {
      this.info("External Documentation: Yes");
    }

    this.info("=".repeat(50));
  }

  public setVerbose(verbose: boolean): void {
    this.config.verbose = verbose;
  }

  public setShowProgress(showProgress: boolean): void {
    this.config.showProgress = showProgress;
  }

  public setUseColors(useColors: boolean): void {
    this.config.useColors = useColors;
  }

  public setLevel(level: keyof LogLevel): void {
    this.config.level = level;
  }

  public configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Global logger instance
export const logger = new Logger();

// Export convenience functions
export const log = {
  error: (message: string, data?: any) => logger.error(message, data),
  warn: (message: string, data?: any) => logger.warn(message, data),
  info: (message: string, data?: any) => logger.info(message, data),
  debug: (message: string, data?: any) => logger.debug(message, data),
  trace: (message: string, data?: any) => logger.trace(message, data),
  step: (step: string, details?: string) => logger.step(step, details),
  fileOperation: (operation: string, filePath: string, details?: string) =>
    logger.fileOperation(operation, filePath, details),
  parsingStep: (step: string, details?: string) =>
    logger.parsingStep(step, details),
  validationStep: (step: string, details?: string) =>
    logger.validationStep(step, details),
  referenceStep: (step: string, refPath: string, details?: string) =>
    logger.referenceStep(step, refPath, details),
  schemaStep: (step: string, schemaName: string, details?: string) =>
    logger.schemaStep(step, schemaName, details),
  endpointStep: (
    step: string,
    method: string,
    path: string,
    details?: string
  ) => logger.endpointStep(step, method, path, details),
  componentStep: (
    step: string,
    componentType: string,
    componentName: string,
    details?: string
  ) => logger.componentStep(step, componentType, componentName, details),
  webhookStep: (step: string, webhookName: string, details?: string) =>
    logger.webhookStep(step, webhookName, details),
  callbackStep: (step: string, callbackName: string, details?: string) =>
    logger.callbackStep(step, callbackName, details),
  summary: (summary: ValidationSummary) => logger.summary(summary),
  detailedSummary: (spec: any, version: string) =>
    logger.detailedSummary(spec, version),
  startOperation: (operation: string) => logger.startOperation(operation),
  endOperation: (operation: string, success: boolean) =>
    logger.endOperation(operation, success),
  startProgress: (total: number, label: string) =>
    logger.startProgress(total, label),
  updateProgress: (current: number) => logger.updateProgress(current),
  endProgress: () => logger.endProgress(),
  setVerbose: (verbose: boolean) => logger.setVerbose(verbose),
  setShowProgress: (showProgress: boolean) =>
    logger.setShowProgress(showProgress),
  setUseColors: (useColors: boolean) => logger.setUseColors(useColors),
  setLevel: (level: keyof LogLevel) => logger.setLevel(level),
  configure: (config: Partial<LoggerConfig>) => logger.configure(config),
};
