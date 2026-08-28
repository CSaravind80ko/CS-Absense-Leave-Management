#!/usr/bin/env sh
set -eu

awslocal s3api create-bucket \
  --bucket attendance-imports-local \
  --create-bucket-configuration LocationConstraint=ap-south-1
awslocal s3api put-public-access-block \
  --bucket attendance-imports-local \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
awslocal s3api create-bucket \
  --bucket attendance-exports-local \
  --create-bucket-configuration LocationConstraint=ap-south-1
awslocal s3api put-public-access-block \
  --bucket attendance-exports-local \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

DLQ_URL="$(awslocal sqs create-queue \
  --queue-name attendance-processing-dlq.fifo \
  --attributes FifoQueue=true \
  --query QueueUrl --output text)"
DLQ_ARN="$(awslocal sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names QueueArn \
  --query Attributes.QueueArn --output text)"
awslocal sqs create-queue \
  --queue-name attendance-processing.fifo \
  --attributes "FifoQueue=true,VisibilityTimeout=120,ReceiveMessageWaitTimeSeconds=20,RedrivePolicy={\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":\"5\"}"
