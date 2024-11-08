import { S3Handler } from "aws-lambda";
import { MongoDBKnowledgeBase } from "./MongoDBKnowledgeBase";
import { MongoClient, ServerApiVersion } from "mongodb";
import { SecretRetreiver } from "../common/SecretRetriever";

const mdbConnSecret = process.env.MONGODB_CONN_SECRET ?? ''
const mdbConnString = process.env.MONGODB_CONN_STRING ?? ''
let mdbKnowledgeBase: MongoDBKnowledgeBase | undefined;

/**
 * @see https://docs.aws.amazon.com/prescriptive-guidance/latest/migration-mongodb-atlas/architecture.html
 * @param event S3 Event message, as seen on https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html
 * @param context
 */
export const handler: S3Handler = async (event) => {
  console.info(event.Records[0] ?? 'Empty event');

  if (!mdbKnowledgeBase) {
    mdbKnowledgeBase = await getKnowledgeBaseInstance();
  }

  for (const record of event.Records) {
    await mdbKnowledgeBase.handleEvent(record);
  }
};

const getKnowledgeBaseInstance = async () => {
  const connString = mdbConnSecret ? await (new SecretRetreiver(mdbConnSecret)).getSecret() : mdbConnString
  if (!connString) {
    throw new Error('Missing MONGODB_CONN_SECRET and MONGODB_CONN_STRING environment variable`')
  }

  const mongoClient = new MongoClient(connString, { serverApi: ServerApiVersion.v1 });
  mongoClient.connect();

  return new MongoDBKnowledgeBase(mongoClient);
}
