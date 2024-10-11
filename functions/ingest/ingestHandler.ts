import { S3Handler } from 'aws-lambda';

/**
 * @param event S3 Event message, as seen on https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html
 * @param context
 */
export const handler: S3Handler = async (event, context) => {
  // event.Records.forEach(record => {
  //   console.log(`Event: ${JSON.stringify(event, null, 2)}`);
  //   console.log(`Context: ${JSON.stringify(context, null, 2)}`);
  // });
}
