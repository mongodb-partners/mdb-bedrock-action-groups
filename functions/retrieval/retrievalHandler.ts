import { Handler, Context } from "aws-lambda";
import { MongoClient, ServerApiVersion } from "mongodb";
import { MongoDBHybridRetriever } from "./MongoDBHybridRetriever";
import { SecretRetreiver } from "../common/SecretRetriever";
import type { BedrockAgentEvent, BedrockAgentResponse } from "./BedrockAgentEvent";

type BedrockAgentHandler = (event: BedrockAgentEvent, context: Context) => Promise<BedrockAgentResponse>

const mdbConnSecret = process.env.MONGODB_CONN_SECRET ?? ''
const mdbConnString = process.env.MONGODB_CONN_STRING ?? ''
const vectorSearchIndex = process.env.MONGODB_VEC_INDEX ?? ''
const textSearchIndex = process.env.MONGODB_FTS_INDEX ?? ''
let mdbHybridRetriever: MongoDBHybridRetriever | undefined;

/**
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/agents-lambda.html
 * @param context
 */
export const handler: BedrockAgentHandler = async (event: BedrockAgentEvent, _context: Context) => {
  console.info(event ?? 'Empty event');

  if (!mdbHybridRetriever) {
    mdbHybridRetriever = await getHybridRetriever();
  }

  const rawFilters = event.parameters?.find(p => p.name === 'filters')?.value;
  const turnFilters = event.promptSessionAttributes?.filters;
  const filters = {
    ...(rawFilters ? JSON.parse(rawFilters) : {}),
    ...(turnFilters ? JSON.parse(turnFilters) : {})
  }
  const result = await mdbHybridRetriever.query(event.inputText, filters);

  const response: BedrockAgentResponse = {
    messageVersion: "1.0",
    response: {
      actionGroup: event.actionGroup,
      function: event.function,
      functionResponse: {
        responseBody: {
          "TEXT": {
            body: `<search_results>${result.map(d => `<search_result>${JSON.stringify(d)}<source>${d.metadata?.source}</source></search_result>`).join('')}</search_results>`,
          }
        }
      }
    },
    sessionAttributes: event.sessionAttributes,
    promptSessionAttributes: event.promptSessionAttributes
  };

  console.info(response)

  return response;
};

const getHybridRetriever = async () => {
  const connString = mdbConnSecret ? await (new SecretRetreiver(mdbConnSecret)).getSecret() : mdbConnString
  if (!connString) {
    throw new Error('Missing MONGODB_CONN_SECRET and MONGODB_CONN_STRING environment variable`')
  }

  const mongoClient = new MongoClient(connString, { serverApi: ServerApiVersion.v1 });
  mongoClient.connect();

  return new MongoDBHybridRetriever(mongoClient, vectorSearchIndex, textSearchIndex);
}
