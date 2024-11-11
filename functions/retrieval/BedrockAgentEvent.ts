/**
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/agents-lambda.html
 * @example
 *   {
 *     "function": "auto_retrieval_function",
 *     "parameters": [
 *         {
 *             "name": "filter",
 *             "type": "string",
 *             "value": "{}"
 *         },
 *         {
 *             "name": "text",
 *             "type": "string",
 *             "value": "Best practices"
 *         }
 *     ],
 *     "messageVersion": "1.0",
 *     "sessionId": "979559056307157",
 *     "agent": {
 *         "name": "agent-mdb-hybrid-search-luiz",
 *         "version": "DRAFT",
 *         "id": "0NPIBTKBZU",
 *         "alias": "TSTALIASID"
 *     },
 *     "sessionAttributes": {
 *         "filter": "{\"andAll\":[{\"equals\":{\"key\":\"region\",\"value\":\"germany\"}},{\"greaterThan\":{\"key\":\"year\",\"value\":2018}}]}"
 *     },
 *     "promptSessionAttributes": {},
 *     "inputText": "Hey! Please retrieve documents from MongoDB knowledge base.",
 *     "actionGroup": "call-hybrid-retrieval-lambda"
 *   }
 */
export type BedrockAgentEvent = {
  function: string,
  parameters: Array<{
    name: string,
    type: string,
    value: string
  }>,
  messageVersion: "1.0",
  sessionId: string,
  agent: {
      name: string,
      version: string,
      id: string,
      alias: string
  },
  sessionAttributes: {
    filter: string,
    [key: string]: string
  },
  promptSessionAttributes: {[key: string]: string},
  inputText: string,
  actionGroup: string
}

/**
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/agents-lambda.html
 */
export type BedrockAgentResponse = {
  messageVersion: "1.0",
  response: {
    actionGroup: string,
    function: string,
    functionResponse: {
      responseState?: "FAILURE" | "REPROMPT",
      responseBody: {
        'TEXT': {
            'body': string
        }
      }
    }
  },
  sessionAttributes?: {
    [key: string]: string,
  },
  promptSessionAttributes?: {
    [key: string]: string
  },
  knowledgeBasesConfiguration?: [
    {
      knowledgeBaseId: string,
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults: number,
          filter: {
            [key: string]: unknown
          }
        }
      }
    }
  ]
}
