import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { Metrics } from "@aws-lambda-powertools/metrics";

const serviceName = "scarevenger";

export const logger = new Logger({ serviceName });
export const tracer = new Tracer({ serviceName });
export const metrics = new Metrics({ serviceName, namespace: "Scarevenger" });
