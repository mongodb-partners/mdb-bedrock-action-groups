import { S3Event } from "aws-lambda";
import { MongoClient } from "mongodb";

export class MongoDBKnowledgeBase {
  constructor(mongodbConnection: MongoClient , bucketName: string) {

  }

  /**
   *
   * @param s3event S3 Event following the structure found at https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html
   */
  handleEvent(s3event: S3Event) {
    s3event.Records.forEach(record => {
      if (record.eventName === 'ObjectCreated:Put') {
        const bucketName = record.s3.bucket.name;
        const objectKey = record.s3.object.key;
        const objectEtag = record.s3.object.eTag;
      }
    });
  }
}
