import { Handler, Context } from "aws-lambda";
import { MongoClient, ServerApiVersion } from "mongodb";
import { MongoDBHybridRetriever } from "./MongoDBHybridRetriever";

type BedrockAgentHandler = (event: BedrockAgentEvent, context: Context) => Promise<BedrockAgentResponse>

const mdbConnString = process.env.MONGODB_CONN_STRING ?? ''
const vectorSearchIndex = process.env.MONGODB_VEC_INDEX ?? ''
const textSearchIndex = process.env.MONGODB_FTS_INDEX ?? ''

if (!mdbConnString) {
  throw new Error('Missing MONGODB_CONN_STRING environment variable`')
}

const mongoClient = new MongoClient(mdbConnString, { serverApi: ServerApiVersion.v1 });
mongoClient.connect();

const mdbHybridRetriever = new MongoDBHybridRetriever(mongoClient, vectorSearchIndex, textSearchIndex);

/**
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/agents-lambda.html
 * @param context
 */
export const handler: Handler = async (event: BedrockAgentEvent, context: Context) => {
  console.info(event ?? 'Empty event');

  const rawFilters = event.parameters?.find(p => p.name === 'filters')?.value;
  const filters = rawFilters ? JSON.parse(rawFilters) : undefined;
  const result = await mdbHybridRetriever.query(event.inputText, filters);

  const response: BedrockAgentResponse = {
    messageVersion: "1.0",
    response: {
      actionGroup: event.actionGroup,
      function: event.function,
      functionResponse: {
        responseBody: {
          "TEXT": {
            body: result.map(d => JSON.stringify(d)).join(','),
          }
        }
      }
    },
    sessionAttributes: event.sessionAttributes,
    promptSessionAttributes: event.promptSessionAttributes
  };

  return response;
};
