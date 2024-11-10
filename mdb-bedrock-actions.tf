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


# Package lambda functions
resource "null_resource" "functions_zip" {
  triggers = {
    always = "${uuid()}"
  }

  # install deps and build before compressing lambda dir
  provisioner "local-exec" {
    working_dir = "${path.module}/functions"
    interpreter = ["/bin/bash" ,"-c"]
    command = <<-EOT
      npm install;
      npm run build
    EOT
  }
}

data "archive_file" "functions_zip" {
  depends_on  = [null_resource.functions_zip]
  type        = "zip"
  source_dir  = "${path.module}/functions"
  output_path = "${path.module}/functions.zip"
}

# Lambda function to ingest newly added documents into knowledge base
resource "aws_lambda_function" "ingest_lambda" {
  function_name    = "${var.stack_name}-IngestLambda"
  role             = aws_iam_role.lambda_role.arn
  handler          = "ingest.ingestHandler.handler" # Lambda handler in compiled output
  runtime          = "nodejs18.x"
  memory_size      = 512
  timeout          = 900 # 15 minutes (ingestion can take some time)
  filename         = "./functions.zip" # Prepackaged deployment package path
  source_code_hash = data.archive_file.functions_zip.output_base64sha256

  environment {
    variables = {
      MONGODB_CONN_STRING = var.mongodb_conn_string
      MONGODB_CONN_SECRET = var.mongodb_conn_secret
    }
  }
}

# Lambda function to retrieve documents from the knowledge base
resource "aws_lambda_function" "retrieval_lambda" {
  function_name    = "${var.stack_name}-RetrievalLambda"
  role             = aws_iam_role.lambda_role.arn
  handler          = "retrieval.retrievalHandler.handler" # Lambda handler in compiled output
  runtime          = "nodejs18.x"
  memory_size      = 512
  timeout          = 300 # 5 minutes
  filename         = "./functions.zip" # Prepackaged deployment package path
  source_code_hash = data.archive_file.functions_zip.output_base64sha256

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
  count = var.mongodb_conn_secret != "" ? 1 : 0 # if variable is not empty
  secret_arn = aws_secretsmanager_secret.mongodb_conn_secret[0].arn

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect    = "Allow",
        Principal = {
          AWS = aws_iam_role.lambda_role.arn
        },
        Action    = "secretsmanager:GetSecretValue",
        Resource  = aws_secretsmanager_secret.mongodb_conn_secret[0].arn
      }
    ]
  })
}

# Trigger the lambda function whenever a new object is added
# or removed from the bucket
resource "aws_s3_bucket_notification" "bucket_notification" {
  bucket = aws_s3_bucket.kb_bucket.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.ingest_lambda.arn
    events              = ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
  }

  depends_on = [aws_lambda_permission.allow_bucket]
}
# Allow the lambda functions to be invoked by S3 bucket
resource "aws_lambda_permission" "allow_bucket" {
  statement_id  = "AllowExecutionFromS3Bucket"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ingest_lambda.arn
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.kb_bucket.arn
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
