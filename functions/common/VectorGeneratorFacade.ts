import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelCommandInput,
} from "@aws-sdk/client-bedrock-runtime";

const MODEL_ID = "amazon.titan-embed-text-v2:0";
const DIMENSIONS = 1024;

type TitanEmbedV2Response = {
  embedding: number[];
  inputTextTokenCount: number;
}

/**
 * Class responsible for generating vector embeddings using
 * Amazon Bedrock Titan Embeddings Model.
 */
export class VectorGeneratorFacade {
  protected model: string;
  protected dimensions: number;
  protected bedrockClient: BedrockRuntimeClient;

  constructor() {
    this.bedrockClient = new BedrockRuntimeClient();
  }

  async generateForDocuments<T extends { text: string; embedding?: number[] }>(
    documents: T[],
  ): Promise<T[]> {
    const result = documents.map(async (doc) => {
      doc.embedding = await this.getVectorEmbeddings(doc.text)
      return doc;
    });

    return Promise.all(result);
  }

  async getVectorEmbeddings(text: string) {
    const params: InvokeModelCommandInput = {
      modelId: MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        inputText: text,
        dimensions: DIMENSIONS,
      }),
    };

    const command: InvokeModelCommand = new InvokeModelCommand(params);
    const res = await this.bedrockClient.send(command);
    const jsonString = new TextDecoder().decode(res.body);
    const response =  JSON.parse(jsonString) as TitanEmbedV2Response;

    return response.embedding;
  }
}
