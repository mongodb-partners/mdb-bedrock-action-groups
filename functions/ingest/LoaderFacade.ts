import * as fs from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const CHUNK_SIZE = 2500;
const CHUNK_OVERLAP = 0;

export type ChunkDoc = {
  text: string;
  embedding?: number[];
  metadata: {
    source: string;
    eTag: string;
  }
}

/**
 * Class responsible for loading PDF files from S3 and splitting
 * them into chunks.
 */
export class LoaderFacade {
    private bucketName: string;
    private objectKey: string;
    private objectEtag: string;
    private s3Client: S3Client;

    /**
     * @param bucketName For instance "my-bucket"
     * @param objectKey For instance "folder/file-name.pdf"
     */
    constructor(bucketName: string, objectKey: string, objectEtag: string) {
        this.bucketName = bucketName
        this.objectKey = objectKey
        this.objectEtag = objectEtag,
        this.s3Client = new S3Client()
    }

    /**
     * Load the PDF file and split it into chunks.
     * @returns
     */
    public async loadAndSplit(): Promise<ChunkDoc[]> {
        const filePath = await this.downloadFile();
        const splittedChunks = await this.splitPdfFile(filePath);
        console.log(splittedChunks[0]);

        return splittedChunks.map((chunk, _) => {
          return {
            text: chunk.pageContent,
            metadata: {
              source: `s3://${this.bucketName}/${this.objectKey}`,
              eTag: this.objectEtag
            }
          };
        })
    }

    /**
     * Downloads the file to be loaded.
     * @returns Path to downloaded file
     */
    protected async downloadFile(): Promise<string> {
      const command = new GetObjectCommand({ Bucket: this.bucketName, Key: this.objectKey });
      const response = await this.s3Client.send(command);

      // Read from stream and return Buffer
      const objectData = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];

        if (response.Body instanceof Readable) {
          response.Body.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.Body.on("end", () => resolve(Buffer.concat(chunks)));
          response.Body.on("error", reject);
        } else {
          reject(new Error("Unable to retrieve S3 file. Response body is not a readable stream."));
        }
      });

      const filePath = `/tmp/${this.objectKey}`;
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, objectData);

      return filePath
    }

    /**
     * Split the downloaded PDF file into chunks.
     * @param filePath
     * @returns
     */
    private async splitPdfFile(filePath: string) {
      const loader = new PDFLoader(filePath);
      const docs = await loader.load();
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: CHUNK_SIZE,
        chunkOverlap: CHUNK_OVERLAP
      });

      const splittedChunks = await splitter.splitDocuments(docs);
      return splittedChunks;
    }
}
