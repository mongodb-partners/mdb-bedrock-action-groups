import { SecretsManagerClient, GetSecretValueCommand, type GetSecretValueCommandInput } from "@aws-sdk/client-secrets-manager";

export class SecretRetreiver {
  private secretId: string;
  private client: SecretsManagerClient;

  constructor(secretId: string) {
    this.secretId = secretId
    this.client = new SecretsManagerClient();
  }

  async getSecret(): Promise<string> {
    const input: GetSecretValueCommandInput = {
      SecretId: this.secretId
    };

    const command = new GetSecretValueCommand(input);
    const response = await this.client.send(command);

    if (!response?.SecretString) {
      throw Error(`Unable to retrieve value of secret named ${this.secretId}`)
    }

    return response.SecretString.trim();
  }
}
