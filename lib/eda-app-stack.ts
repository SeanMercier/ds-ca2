import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from "constructs";

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create DynamoDB Table named ImageTable
    const imageTable = new dynamodb.Table(this, "ImageTable", {
      partitionKey: {
        name: "ImageName",
        type: dynamodb.AttributeType.STRING
      },
      stream: dynamodb.StreamViewType.NEW_IMAGE
    });

    // S3 Bucket for storing images
    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    // Integration infrastructure 
    // Queue for DLQ created
    const deadLetterQueue = new sqs.Queue(this, "dead-letter-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10)
    });

    // Create DLQ
    const deadLetterQueue1: sqs.DeadLetterQueue = {
      queue: deadLetterQueue,
      maxReceiveCount: 1
    };

    const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
      deadLetterQueue: deadLetterQueue1
    });

    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image topic",
    });

    // Lambda functions
    const processImageFn = new lambdanode.NodejsFunction(this, "ProcessImageFn", {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/processImage.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        DLQ_URL: deadLetterQueue.queueUrl,
        TABLE_NAME: imageTable.tableName,
        REGION: "eu-west-1",
      }
    });

    const updateTableFn = new lambdanode.NodejsFunction(this, "UpdateTableFn", {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/updateTable.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        IMAGE_TABLE_NAME: imageTable.tableName
      }
    });

    const mailerFn = new lambdanode.NodejsFunction(this, "MailerFunction", {
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/mailer.ts`,
    });

    const rejectionMailerFn = new lambdanode.NodejsFunction(this, 'RejectionMailerFn', {
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/rejectionMailer.ts`,
    });

    // S3 --> SQS
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)
    );

    // Event Sources
    newImageTopic.addSubscription(
      new subs.LambdaSubscription(mailerFn, {
        filterPolicyWithMessageBody: {
          Records: sns.FilterOrPolicy.policy({
            eventName: sns.FilterOrPolicy.filter(sns.SubscriptionFilter.stringFilter({
              allowlist: ["ObjectCreated:Put"],
            })),
          })
        }
      })
    );

    newImageTopic.addSubscription(
      new subs.LambdaSubscription(updateTableFn, {
        filterPolicy: {
          metadata_type: sns.SubscriptionFilter.stringFilter({
            allowlist: ["Caption", "Date", "Photographer"]
          })
        }
      })
    );

    newImageTopic.addSubscription(
      new subs.SqsSubscription(imageProcessQueue, {
        filterPolicyWithMessageBody: {
          Records: sns.FilterOrPolicy.policy({
            eventName: sns.FilterOrPolicy.filter(sns.SubscriptionFilter.stringFilter({
              allowlist: ["ObjectCreated:Put"],
            })),
          })
        }
      })
    );

    // SQS --> Lambda Event Sources
    const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(5),
    });

    processImageFn.addEventSource(newImageEventSource);

    const newImageEventSource1 = new events.SqsEventSource(deadLetterQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(5)
    });

    rejectionMailerFn.addEventSource(newImageEventSource1);

    // Permissions

    imagesBucket.grantRead(processImageFn);
    imageTable.grantReadWriteData(processImageFn);
    imageTable.grantReadWriteData(updateTableFn);

    mailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

    rejectionMailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

    processImageFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "sqs:SendMessage"
        ],
        resources: ["*"],
      })
    );

    // Outputs
    new cdk.CfnOutput(this, "bucketName", {
      value: imagesBucket.bucketName,
    });
  }
}
