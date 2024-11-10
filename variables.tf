/**
 * Set `mongodb_conn_string` to with connection string or PrivateLink endpoint
 * @example "mongodb+srv://<username>:<password>@cluster-b.6vlan.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
 */
variable "mongodb_conn_string" {
  type    = string
  default = "" # Replace with actual MongoDB connection string if desired
}

/**
 * Set `mongodb_conn_secret` with the name of the secret containing a connection string
 * @example
 *   "secretName"
 *   // with value mongodb+srv://<username>:<password>@cluster-b.6vlan.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
 */
variable "mongodb_conn_secret" {
  type    = string
  default = ""
}

variable "access_key" {
  description = "The access key for AWS Account"
  type        = string
}

variable "secret_key" {
  description = "The secret key for AWS Account"
  type        = string
}
