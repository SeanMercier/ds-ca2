import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Bucket for storing images
    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    // DynamoDB Table for storing image metadata
    const imageTable = new dynamodb.Table(this, "ImageTable", {
      partitionKey: { name: "fileName", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Dead Letter Queue for invalid file types
    const dlq = new sqs.Queue(this, "DLQ", {
      retentionPeriod: cdk.Duration.days(14),
    });

    // SQS Queue for processing image messages
    const imageProcessQueue = new sqs.Queue(this, "ImageProcessQueue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    // Add policy to allow the ImageProcessQueue to send messages to DLQ
    dlq.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: ["sqs:SendMessage"],
        resources: [dlq.queueArn],
        conditions: {
          ArnEquals: {
            "aws:SourceArn": imageProcessQueue.queueArn,
          },
        },
      })
    );

    // SNS Topic for image events
    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image Topic",
    });

    // Mailer Queue for email notifications
    const mailerQueue = new sqs.Queue(this, "MailerQueue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    });

    // Lambda Function: Process Image
    const processImageFn = new lambdanode.NodejsFunction(this, "ProcessImageFn", {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/processImage.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        TABLE_NAME: imageTable.tableName, // Set environment variable to the imageTable's name
        REGION: "eu-west-1",  // SES region
      },
    });

    // Add permissions for the ProcessImageFn Lambda
    processImageFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:BatchWriteItem"],
        resources: [imageTable.tableArn],
      })
    );

    processImageFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
          "sqs:ChangeMessageVisibility",
        ],
        resources: [imageProcessQueue.queueArn],
      })
    );

    processImageFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:GetObject", "s3:ListBucket"],
        resources: [
          imagesBucket.bucketArn,
          `${imagesBucket.bucketArn}/*`,
        ],
      })
    );

    imageTable.grantReadWriteData(processImageFn);

    // Lambda Function: Mailer
    const mailerFn = new lambdanode.NodejsFunction(this, "MailerFunction", {
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/mailer.ts`,
    });

    // Lambda Function: Rejection Mailer
    const rejectionMailerFn = new lambdanode.NodejsFunction(this, "RejectionMailerFn", {
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 128,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/rejectionMailer.ts`,
      environment: {
        SES_EMAIL_FROM: "20094677@mail.wit.ie",
        SES_EMAIL_TO: "20094677@mail.wit.ie",      
        SES_REGION: "eu-west-1",  // SES region
      },
    });

    rejectionMailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ses:SendEmail", "ses:SendRawEmail", "ses:SendTemplatedEmail"],
        resources: ["*"],
      })
    );

    rejectionMailerFn.addEventSource(
      new events.SqsEventSource(dlq, {
        batchSize: 5,
      })
    );

    // S3 -> SNS
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)
    );

    // SNS -> SQS Subscriptions
    newImageTopic.addSubscription(new subs.SqsSubscription(imageProcessQueue));
    newImageTopic.addSubscription(new subs.SqsSubscription(mailerQueue));

    // SQS -> Lambda Event Sources
    processImageFn.addEventSource(
      new events.SqsEventSource(imageProcessQueue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(5),
      })
    );

    mailerFn.addEventSource(
      new events.SqsEventSource(mailerQueue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(5),
      })
    );

    // Outputs
    new cdk.CfnOutput(this, "BucketName", {
      value: imagesBucket.bucketName,
    });
    new cdk.CfnOutput(this, "ImageTableName", {
      value: imageTable.tableName,
    });
    new cdk.CfnOutput(this, "DLQName", {
      value: dlq.queueName,
    });
  }
}
