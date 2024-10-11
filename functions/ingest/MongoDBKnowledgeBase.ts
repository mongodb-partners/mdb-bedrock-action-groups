import { S3Event } from "aws-lambda";
import { MongoClient } from "mongodb";

const DB_NAME = process.env.DB_NAME ?? "knowledgebase";
const COL_INVENTORY = process.env.COL_INVENTORY ?? "kbInventory";
const COL_CHUNKS = process.env.COL_CHUNKS ?? "kbChunks";

type InventoryEntryDoc = {
  _id: string;
  eTag: string;
  ingestedAt: Date;
};

type ChunkDoc = {
  text: string;
  metadata: {
    source: string;
    eTag: string;
  }
}

export class MongoDBKnowledgeBase {
  mongodb: MongoClient;

  constructor(mongoClient: MongoClient) {
    this.mongodb = mongoClient;
  }

  /**
   * Handle ObjectCreated:Put S3Events.
   * Ingest the given s3 object into the knowledge base's chunk collection.
   * This method will parse, chunk, generate the vector embeddings and insert
   * the data in MongoDB.
   * @param s3event S3 Event following the structure found at https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html
   */
  async handleEvent(s3event: S3Event) {
    for (const record of s3event.Records) {
      if (record.eventName.startsWith("ObjectCreated:")) {
        const bucketName = record.s3.bucket.name;
        const objectKey = record.s3.object.key;
        const objectEtag = record.s3.object.eTag;

        const shouldIngest = !await this.isIngested(
          bucketName,
          objectKey,
          objectEtag,
        );

        if (shouldIngest) {
          console.info(`Ingesting object ${objectKey} from bucket ${bucketName}.`);
          await this.ingestObject(bucketName, objectKey, objectEtag);
          await this.markAsIngested(bucketName, objectKey, objectEtag);
          console.info(`Object ${objectKey} from bucket ${bucketName} ingested successfully.`);
        } else {
          console.info(`Object ${objectKey} from bucket ${bucketName} has already been ingested, skipping ingestion.`);
        }
      }
    }
  }

  /**
   * Ingest the given s3 object into the knowledge base's chunk collection.
   * This method will parse, chunk, generate the vector embeddings and insert
   * the data in MongoDB.
   * @param bucketName
   * @param objectKey
   * @param objectEtag
   */
  async ingestObject(
    bucketName: string,
    objectKey: string,
    objectEtag: string,
  ): Promise<void> {
    const s3Address = `s3://${bucketName}/${objectKey}`;

    // Remove stale chunks for this object
    const staleRemoval = this.mongodb.db(DB_NAME)
      .collection<ChunkDoc>(COL_CHUNKS)
      .deleteMany({
        metadata: {
          source: s3Address,
          eTag: { $ne: objectEtag } // where eTag is not equal the new one
        }
      });

    // Insert new chunks for object
    const insertion = this.mongodb.db(DB_NAME)
      .collection<ChunkDoc>(COL_CHUNKS)
      .insertMany([
        {
          text: 'Loren ipsum dolor',
          metadata: {
            source: s3Address,
            eTag: objectEtag
          }
        },
        {
          text: 'sit amet, consectetur adipiscing',
          metadata: {
            source: s3Address,
            eTag: objectEtag
          }
        }
      ]);

      await Promise.all([staleRemoval, insertion]);
  }

  /**
   * Check the inventory collection to find if given object was
   * previously ingested.
   * @param bucketName
   * @param objectKey
   * @param objectEtag
   * @returns
   */
  protected async isIngested(
    bucketName: string,
    objectKey: string,
    objectEtag: string,
  ): Promise<boolean> {
    const s3Address = `s3://${bucketName}/${objectKey}`;

    // Check if the object exists with given eTag in the inventory
    const exists = await this.mongodb.db(DB_NAME)
      .collection<InventoryEntryDoc>(COL_INVENTORY)
      .findOne(
        { _id: s3Address, eTag: objectEtag },
        { projection: { _id: 1 } },
      );

    return exists !== null;
  }

  /**
   * Mark the given s3 object as ingested in the knowledge base by
   * inserting or updating the inventory collection.
   * @param bucketName
   * @param objectKey
   * @param objectEtag
   */
  protected async markAsIngested(
    bucketName: string,
    objectKey: string,
    objectEtag: string,
  ): Promise<void> {
    const s3Address = `s3://${bucketName}/${objectKey}`;

    // Insert or updates object path and eTag to inventory
    await this.mongodb.db(DB_NAME)
      .collection<InventoryEntryDoc>(COL_INVENTORY)
      .findOneAndReplace(
        { _id: s3Address },
        { eTag: objectEtag, ingestedAt: new Date() },
        { upsert: true },
      );
  }
}
