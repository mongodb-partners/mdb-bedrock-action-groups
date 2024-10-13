import { S3Handler } from "aws-lambda";
import { MongoDBKnowledgeBase } from "./MongoDBKnowledgeBase";
import { MongoClient, ServerApiVersion } from "mongodb";

const mdbConnString = process.env.MONGODB_CONN_STRING ?? ''
if (!mdbConnString) {
  throw new Error('Missing MONGODB_CONN_STRING environment variable`')
}

const mongoClient = new MongoClient(mdbConnString, { serverApi: ServerApiVersion.v1 });
mongoClient.connect();

const mdbKnowledgeBase = new MongoDBKnowledgeBase(mongoClient);

/**
 * @see https://docs.aws.amazon.com/prescriptive-guidance/latest/migration-mongodb-atlas/architecture.html
 * @param event S3 Event message, as seen on https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html
 * @param context
 */
export const handler: S3Handler = async (event) => {
  console.info(event.Records[0] ?? 'Empty event');

  for (const record of event.Records) {
    await mdbKnowledgeBase.handleEvent(record);
  }
};
