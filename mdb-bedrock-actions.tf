variable "stack_name" {
  type    = string
  default = "mdb-bedrock-actions-stack"
}

# Bucket to place the files that will compose our knowledge base.
resource "aws_s3_bucket" "kb_bucket" {
  bucket = "${lower(var.stack_name)}-kb-datasource"

  lifecycle {
    prevent_destroy = false
  }

  force_destroy = true
}

# Lambda function to ingest newly added documents
resource "aws_lambda_function" "ingest_lambda" {
  function_name = "${var.stack_name}-IngestLambda"
  role          = aws_iam_role.lambda_role.arn
  handler       = "handler" # Update as per Lambda handler in compiled output
  runtime       = "nodejs18.x"
  memory_size   = 512
  timeout       = 900 # 15 minutes
  filename      = "./functions/ingest/ingestHandler.zip" # Prepackaged deployment package path

  environment {
    variables = {
      MONGODB_CONN_STRING = var.mongodb_conn_string
      MONGODB_CONN_SECRET = var.mongodb_conn_secret
    }
  }
}

# Lambda function to retrieve documents
resource "aws_lambda_function" "retrieval_lambda" {
  function_name = "${var.stack_name}-RetrievalLambda"
  role          = aws_iam_role.lambda_role.arn
  handler       = "handler" # Update as per Lambda handler in compiled output
  runtime       = "nodejs18.x"
  memory_size   = 512
  timeout       = 900 # 15 minutes
  filename      = "./functions/retrieval/retrievalHandler.zip" # Prepackaged deployment package path

  environment {
    variables = {
      MONGODB_CONN_STRING = var.mongodb_conn_string
      MONGODB_CONN_SECRET = var.mongodb_conn_secret
      MONGODB_VEC_INDEX   = "vector_index"
      MONGODB_FTS_INDEX   = "text_index"
    }
  }
}

# Setup lambda role
resource "aws_iam_role_policy_attachment" "lambda_attach_policy" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = aws_iam_policy.bedrock_invoke_policy.arn
}

resource "aws_iam_role" "lambda_role" {
  name               = "${var.stack_name}-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Principal = {
          Service = "lambda.amazonaws.com"
        },
        Action = "sts:AssumeRole"
      }
    ]
  })
}

# Grant the lambda functions permissions to invoke Bedrock
resource "aws_iam_policy" "bedrock_invoke_policy" {
  name   = "${var.stack_name}-bedrock-invoke-policy"
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect   = "Allow",
        Action   = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelEndpoint",
          "bedrock:InvokeModelEndpointAsync",
          "bedrock:InvokeModelWithResponseStream"
        ],
        Resource = "arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v2:0"
      }
    ]
  })
}

# Grant the lambda function permissions to access the bucket
resource "aws_iam_role_policy_attachment" "lambda_s3_access" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"
}

# Allow the lambda functions to be invoked by bedrock
resource "aws_lambda_permission" "allow_bedrock" {
  statement_id  = "AllowBedrock"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.retrieval_lambda.arn
  principal     = "bedrock.amazonaws.com"
}

# Grant the lambda function permissions to retrieve secret
resource "aws_secretsmanager_secret" "mongodb_conn_secret" {
  count = var.mongodb_conn_secret != "" ? 1 : 0 # if variable is not empty
  name = var.mongodb_conn_secret
}
resource "aws_secretsmanager_secret_policy" "mongodb_conn_secret_policy" {
  secret_arn = aws_secretsmanager_secret.mongodb_conn_secret.arn

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect    = "Allow",
        Principal = {
          AWS = aws_iam_role.lambda_role.arn
        },
        Action    = "secretsmanager:GetSecretValue",
        Resource  = aws_secretsmanager_secret.mongodb_conn_secret.arn
      }
    ]
  })
}

# Trigger the lambda function whenever a new object is added
# or removed from the bucket
resource "aws_s3_bucket_notification" "bucket_notification" {
  bucket = aws_s3_bucket.bucket.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.ingest_lambda.arn
    events              = ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
  }

  depends_on = [aws_lambda_permission.allow_bucket]
}

output "bucket_name" {
  value = aws_s3_bucket.kb_bucket.bucket
}

output "ingest_lambda_arn" {
  value = aws_lambda_function.ingest_lambda.arn
}

output "retrieval_lambda_arn" {
  value = aws_lambda_function.retrieval_lambda.arn
}
