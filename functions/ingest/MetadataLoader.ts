import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

/**
 * Class responsible for loading metadata files from S3.
 */
export class MetadataLoader {
  private bucketName: string;
  private objectKey: string;
  private s3Client: S3Client;

  /**
   * @param bucketName For instance "my-bucket"
   * @param objectKey For instance "folder/file-name.pdf.metadata.json"
   */
  constructor(bucketName: string, metadataObjectKey: string) {
    this.bucketName = bucketName;
    this.objectKey = metadataObjectKey;
    this.s3Client = new S3Client()
  }

  /**
   * Load metadata from S3 and parse it as JSON.
   * @returns Parsed metadata or null if not found.
   */
  async load(): Promise<{[key: string]: any} | null>{
    let filePath: string;

    try {
      filePath = await this.downloadFile();
    } catch (err) {
      console.info(`Metadata file ${this.objectKey} not present.`);
      return null
    }

    const fileContents = await fs.readFile(filePath, 'utf8');
    const metadata = JSON.parse(fileContents);
    return metadata
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
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, objectData);

    return filePath
  }
}
