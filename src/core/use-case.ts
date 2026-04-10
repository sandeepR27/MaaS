import { z } from "zod";
// import { trace } from "@opentelemetry/api"; // Will enable once OTEL is configured

/**
 * Base UseCase class enforcing input validation via Zod 
 * and standardizing structured execution logic.
 */
export abstract class UseCase<Input, Output, Schema extends z.ZodTypeAny> {
  /**
   * Zod schema definition for strict input validation.
   */
  protected abstract schema: Schema;

  /**
   * The core implementation of the use case.
   */
  protected abstract executeImpl(input: z.infer<Schema>): Promise<Output>;

  /**
   * Public interface to run the use case. 
   * It handles validation, tracing, and execution centrally.
   */
  public async execute(input: Input): Promise<Output> {
    // 1. Validate Input
    let parsedInput: z.infer<Schema>;
    try {
      parsedInput = await this.schema.parseAsync(input);
    } catch (validationError) {
      console.error("UseCase input validation failed:", validationError);
      throw validationError; 
    }

    // 2. Prepare Context / Logging / Tracing
    // const tracer = trace.getTracer('use-cases');
    // return await tracer.startActiveSpan(`UseCase_${this.constructor.name}`, async (span) => {
    try {
      // 3. Execute core logic
      const result = await this.executeImpl(parsedInput);
      return result;
    } catch (error) {
      // span.recordException(error as Error);
      console.error(`Error executing ${this.constructor.name}:`, error);
      throw error;
    } finally {
      // span.end();
    }
    // });
  }
}
