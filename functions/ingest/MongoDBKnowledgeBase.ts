import { S3EventRecord } from "aws-lambda";
import { MongoClient } from "mongodb";
import { ChunkDoc, LoaderFacade } from "./LoaderFacade";
import { VectorGeneratorFacade } from "./VectorGeneratorFacade";
import { MetadataLoader } from "./MetadataLoader";

const DB_NAME = process.env.DB_NAME ?? "knowledgebase";
const COL_INVENTORY = process.env.COL_INVENTORY ?? "kbInventory";
const COL_CHUNKS = process.env.COL_CHUNKS ?? "kbChunks";

type InventoryEntryDoc = {
  _id: string;
  eTag: string;
  updatedAt: Date;
  status: 'success' | 'fail' | 'removed';
  error?: string;
};

export class MongoDBKnowledgeBase {
  mongodb: MongoClient;

  constructor(mongoClient: MongoClient) {
    this.mongodb = mongoClient;
  }

  /**
   * Handle ObjectCreated:Put and ObjectRemoved:Delete S3 events.
   * Ingest the given s3 object into the knowledge base's chunk collection.
   * This method will parse, chunk, generate the vector embeddings and insert
   * the data in MongoDB.
   * If a ObjectRemoved event is received, remove chunks from
   * MongoDB.
   * If an objectKey ends with `metadata.json`, process as metadata.
   *
   * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html
   * @see https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-knowledge-bases-now-supports-metadata-filtering-to-improve-retrieval-accuracy/
   *
   * @param s3eventRecord S3 Event Record following the structure found at https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html
   */
  async handleEvent(s3eventRecord: S3EventRecord) {
    const bucketName = s3eventRecord.s3.bucket.name;
    const objectKey = cleanS3Key(s3eventRecord.s3.object.key);
    const objectEtag = s3eventRecord.s3.object.eTag;
    const isMetadataFile = objectKey.endsWith(".metadata.json")

    // Handle remove
    if (s3eventRecord.eventName.startsWith("ObjectRemoved:")) {
      await this.removeObject(bucketName, objectKey);
      await this.markAsRemoved(bucketName, objectKey);
      return
    }

    // Handle metadata
    if (s3eventRecord.eventName.startsWith("ObjectCreated:") && isMetadataFile) {
      await this.ingestMetadata(bucketName, objectKey);
      return
    }

    // Handle insert/update
    if (s3eventRecord.eventName.startsWith("ObjectCreated:")) {
      const isPdf = objectKey.endsWith(".pdf");
      const isIngested = await this.isIngested(
        bucketName,
        objectKey,
        objectEtag,
      );

      if (!isPdf) {
        console.info(`Skipping non-PDF object ${objectKey} from bucket ${bucketName}.`);
        return;
      }

      if (isIngested) {
        console.info(`Skipping object ${objectKey} from bucket ${bucketName}, ETag haven't changed.`);
        return;
      }

      try {
        await this.ingestObject(bucketName, objectKey, objectEtag);
        await this.markAsIngested(bucketName, objectKey, objectEtag);
        console.info(`Object ${objectKey} from bucket ${bucketName} ingested successfully.`);
        await this.ingestMetadata(bucketName, objectKey);
      } catch (error) {
        console.error(`Unable to ingest Object ${objectKey} from bucket ${bucketName}.`);
        console.error(error);
        await this.markAsError(
          bucketName,
          objectKey,
          objectEtag,
          error as Error,
        );
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
    console.info(`Ingesting object ${objectKey} from bucket ${bucketName}.`);
    const s3Address = `s3://${bucketName}/${objectKey}`;
    const loader = new LoaderFacade(bucketName, objectKey, objectEtag);
    const vecGenerator = new VectorGeneratorFacade();

    // Load file and split
    const chunks = await loader.loadAndSplit();

    // Generate vector embeddings
    const chunksWithVector = await vecGenerator.generateForDocuments(chunks);

    // Insert new chunks for object
    const insertion = this.mongodb.db(DB_NAME)
      .collection<ChunkDoc>(COL_CHUNKS)
      .insertMany(chunksWithVector);

    // Remove stale chunks for this object
    const staleRemoval = this.mongodb.db(DB_NAME)
      .collection<ChunkDoc>(COL_CHUNKS)
      .deleteMany({
        "metadata.source": s3Address,
        "metadata.eTag": { $ne: objectEtag }, // where eTag is not equal the new one
      });

    await Promise.all([staleRemoval, insertion]);
  }

  /**
   * Removes the given s3 object from the knowledge base's chunk collection.
   * @param bucketName
   * @param objectKey
   * @param objectEtag
   */
  async removeObject(
    bucketName: string,
    objectKey: string
  ): Promise<void> {
    console.info(`Removing object ${objectKey} - bucket ${bucketName} from knowledge base collection.`,);
    const s3Address = `s3://${bucketName}/${objectKey}`;

    // Remove stale chunks for this object
    const staleRemoval = this.mongodb.db(DB_NAME)
      .collection<ChunkDoc>(COL_CHUNKS)
      .deleteMany({
        "metadata.source": s3Address
      });

    staleRemoval
  }

  /**
   * Ingest the associated metadata field for the given file.
   * @see https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-knowledge-bases-now-supports-metadata-filtering-to-improve-retrieval-accuracy/
   * @param bucketName
   * @param objectKey Can either be `file.pdf.metadata.json` or `file.pdf`. The method will resolve and load the `.metadata.json` for the given object.
   */
  async ingestMetadata(
    bucketName: string,
    objectKey: string,
  ) {
    const targetObjectKey = objectKey.replace(/\.metadata\.json$/, "");
    const metadataObjectKey = `${targetObjectKey}.metadata.json`;
    const s3Address = `s3://${bucketName}/${targetObjectKey}`;

    console.info(`Ingesting metadata for ${targetObjectKey} from bucket ${bucketName}.`);
    const metadataLoader = new MetadataLoader(bucketName, metadataObjectKey);
    const metadata = await metadataLoader.load();

    if (!metadata) {
      return // no metadata found
    }

    // Updates metadata field of existing chunks
    await this.mongodb.db(DB_NAME)
      .collection<ChunkDoc>(COL_CHUNKS)
      .updateMany(
        { "metadata.source": s3Address },
        [{$addFields: { metadata: metadata }}],
      );
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
        { _id: s3Address, eTag: objectEtag, status: "success" },
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
        { eTag: objectEtag, updatedAt: new Date(), status: "success" },
        { upsert: true },
      );
  }

  /**
   * Mark the given s3 object as removed from the knowledge base by
   * updating the document in the inventory collection.
   * @param bucketName
   * @param objectKey
   * @param objectEtag
   */
  protected async markAsRemoved(
    bucketName: string,
    objectKey: string
  ): Promise<void> {
    const s3Address = `s3://${bucketName}/${objectKey}`;

    // Insert or updates object path and eTag to inventory
    await this.mongodb.db(DB_NAME)
      .collection<InventoryEntryDoc>(COL_INVENTORY)
      .findOneAndReplace(
        { _id: s3Address },
        { eTag: '0', updatedAt: new Date(), status: "removed" },
        { upsert: false },
      );
  }

  /**
   * Mark the given s3 object as failed in the knowledge base by
   * inserting or updating the inventory collection.
   * @param bucketName
   * @param objectKey
   * @param objectEtag
   */
  protected async markAsError(
    bucketName: string,
    objectKey: string,
    objectEtag: string,
    error: Error,
  ): Promise<void> {
    const s3Address = `s3://${bucketName}/${objectKey}`;
    const errorString = typeof error === "object"
      ? JSON.stringify({ error: error.toString(), stack: error.stack })
      : String(error);

    // Insert or updates object path and eTag to inventory
    await this.mongodb.db(DB_NAME)
      .collection<InventoryEntryDoc>(COL_INVENTORY)
      .findOneAndReplace(
        { _id: s3Address },
        {
          eTag: objectEtag,
          updatedAt: new Date(),
          status: "fail",
          error: errorString,
        },
        { upsert: true },
      );
  }
}

/**
 * Object key may have spaces or unicode non-ASCII characters
 * @see https://docs.aws.amazon.com/lambda/latest/dg/with-s3-tutorial.html#with-s3-tutorial-create-function-code
 * @param s3Key
 * @returns
 */
const cleanS3Key = (s3Key: string) =>
  decodeURIComponent(s3Key.replace(/\+/g, " "));
