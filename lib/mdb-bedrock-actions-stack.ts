import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Runtime, FunctionUrlAuthType } from "aws-cdk-lib/aws-lambda"
import { S3EventSource } from "aws-cdk-lib/aws-lambda-event-sources"
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs"
import { Bucket, EventType as S3EventTYpe } from "aws-cdk-lib/aws-s3"

export class MdbBedrockActionsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    /**
     * Bucket to place the files that will compose our knowledge base.
     */
    const kbBucket = new Bucket(this, "KnowledgeBaseBucket", {
      bucketName: 'my-first-bucket',
      publicReadAccess: false,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true // ensure bucket deleted with `cdk destroy`
    })

    /**
     * Lambda function to ingest newly added documents
     */
    const ingestLambda = new NodejsFunction(this, "IngestLambda", {
      runtime: Runtime.NODEJS_18_X,
      entry: "./functions/ingest/ingestHandler.ts",
      handler: "handler",
      environment: {
        KB_BUCKET: kbBucket.bucketName
      }
    })

    /**
     * Trigger the lambda function whenever a new object is added
     * to the bucket
     */
    const s3PutEventSource = new S3EventSource(kbBucket, {
      events: [
        S3EventTYpe.OBJECT_CREATED_PUT
      ]
    });

    ingestLambda.addEventSource(s3PutEventSource);
  }
}
