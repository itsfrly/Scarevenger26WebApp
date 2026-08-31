import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { tracer } from "./observability";

export const TABLE_NAME = process.env.TABLE_NAME!;

export const ddb = DynamoDBDocumentClient.from(
  tracer.captureAWSv3Client(new DynamoDBClient({})),
  { marshallOptions: { removeUndefinedValues: true } },
);
