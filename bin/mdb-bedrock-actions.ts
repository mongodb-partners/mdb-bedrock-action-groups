#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MdbBedrockActionsStack } from '../lib/mdb-bedrock-actions-stack';

const app = new cdk.App();
new MdbBedrockActionsStack(app, 'MdbBedrockActionsStack');
