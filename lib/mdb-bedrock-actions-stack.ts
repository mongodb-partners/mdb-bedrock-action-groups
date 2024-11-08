import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { LoggingFormat, Runtime } from "aws-cdk-lib/aws-lambda";
import { S3EventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Bucket, EventType as S3EventType } from "aws-cdk-lib/aws-s3";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";

/**
 * Set MONGODB_CONN_STRING to with connection string or PrivateLink endpoint
 * @example "mongodb+srv://<username>:<password>@cluster-b.6vlan.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
 */
const MONGODB_CONN_STRING = '';

/**
 * Set MONGODB_CONN_SECRET with the name of the secret containing a connection string
 * @example
 *   "secretName"
 *   // with value mongodb+srv://<username>:<password>@cluster-b.6vlan.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
 */
const MONGODB_CONN_SECRET = 'mdb_bedrock_demo_credentials';

export class MdbBedrockActionsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    /**
     * Bucket to place the files that will compose our knowledge base.
     */
    const kbBucket = new Bucket(this, "KnowledgeBaseDataSource", {
      bucketName: `${this.stackName.toLowerCase()}-kb-datasource`,
      publicReadAccess: false,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true, // ensure bucket deleted with `cdk destroy`
    });

    /**
     * Lambda function to ingest newly added documents
     */
    const ingestLambda = new NodejsFunction(this, "IngestLambda", {
      runtime: Runtime.NODEJS_18_X,
      timeout: Duration.minutes(15),
      memorySize: 512,
      functionName: `${this.stackName}-IngestLambda`,
      depsLockFilePath: "./functions/ingest/package-lock.json",
      entry: "./functions/ingest/ingestHandler.ts",
      handler: "handler",
      environment: {
        MONGODB_CONN_STRING,
        MONGODB_CONN_SECRET,
      },
      loggingFormat: LoggingFormat.JSON,
    });

    /**
     * Lambda function to retrieve documents
     */
    const retrievalLambda = new NodejsFunction(this, "RetrievalLambda", {
      runtime: Runtime.NODEJS_18_X,
      timeout: Duration.minutes(15),
      memorySize: 512,
      functionName: `${this.stackName}-RetrievalLambda`,
      depsLockFilePath: "./functions/retrieval/package-lock.json",
      entry: "./functions/retrieval/retrievalHandler.ts",
      handler: "handler",
      environment: {
        MONGODB_CONN_STRING,
        MONGODB_CONN_SECRET,
        MONGODB_VEC_INDEX: 'vector_index',
        MONGODB_FTS_INDEX: 'text_index',
      },
      loggingFormat: LoggingFormat.JSON,
    });

    /**
     * Trigger the lambda function whenever a new object is added
     * or removed from the bucket
     */
    const s3EventSource = new S3EventSource(kbBucket, {
      events: [
        S3EventType.OBJECT_CREATED,
        S3EventType.OBJECT_REMOVED,
      ],
    });
    ingestLambda.addEventSource(s3EventSource);

    /**
     * Grant the lambda function permissions to access the bucket
     */
    kbBucket.grantReadWrite(ingestLambda);

    /**
     * If MONGODB_CONN_SECRET is set, grant the lambda function permissions
     * to access the connection string
     */
    if (MONGODB_CONN_SECRET) {
      const mongoDBConnStringSecret = Secret.fromSecretNameV2(this, 'SecretMongoDBConnString', MONGODB_CONN_SECRET);
      mongoDBConnStringSecret.grantRead(ingestLambda);
      mongoDBConnStringSecret.grantRead(retrievalLambda);
    }

    /**
     * Grant the lambda functions permissions to invoke Bedrock
     */
    const allowBedrockInvocation = new PolicyStatement({
      actions: [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelEndpoint",
        "bedrock:InvokeModelEndpointAsync",
        "bedrock:InvokeModelWithResponseStream"
      ],
      resources: [
        `arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v2:0`
      ],
    });

    ingestLambda.role?.addToPrincipalPolicy(allowBedrockInvocation);
    retrievalLambda.role?.addToPrincipalPolicy(allowBedrockInvocation);

    /**
     * Allow funciton to be invoked by an Bedrock agent
     */
    retrievalLambda.grantInvoke(new ServicePrincipal("bedrock.amazonaws.com"));
  }

}
