provider "aws" {
  access_key = var.access_key
  secret_key = var.secret_key
  token = var.session_token
  region     = "eu-central-1"
}
