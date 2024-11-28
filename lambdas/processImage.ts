/* eslint-disable import/extensions, import/no-absolute-path */
import { SQSHandler } from "aws-lambda";
import {
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const s3 = new S3Client();
const ddbDocClient = createDDbDocClient();

const validFileExtensions = [".jpeg", ".png"]; // Allowed file types
const tableName = process.env.TABLE_NAME; // DynamoDB table name

if (!tableName) {
  throw new Error("Environment variable TABLE_NAME is not set");
}

export const handler: SQSHandler = async (event) => {
  console.log("Event ", event);

  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body);
    console.log('Raw SNS message ', JSON.stringify(recordBody));

    const recordMessage = JSON.parse(recordBody.Message);
    console.log('SNS Message: ', recordMessage);

    if (recordMessage.Records) {
      for (const messageRecord of recordMessage.Records) {

        const s3e = messageRecord.s3;
        const srcBucket = s3e.bucket.name;
        const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " ")); // Decode S3 object key

        console.log(`Processing file: ${srcKey} in bucket: ${srcBucket}`);

        // Validate file type
        const fileExtension = srcKey.split('.').pop()?.toLowerCase();
        if (!fileExtension || !validFileExtensions.includes(`.${fileExtension}`)) {
          console.error(`Invalid file type for file: ${srcKey}`);
          throw new Error(`Invalid file type for file: ${srcKey}`);
        }

        try {
          // Download the image from S3
          const params = {
            Bucket: srcBucket,
            Key: srcKey,
          };
          const origimage = await s3.send(new GetObjectCommand(params));
          console.log(`Successfully retrieved file from S3: ${srcKey}`);

          // Add image metadata to DynamoDB
          await ddbDocClient.send(
            new PutCommand({
              TableName: tableName,
              Item: {
                "fileName": srcKey, // Primary key
              },
            })
          );
          console.log(`Successfully added ${srcKey} to DynamoDB`);
        } catch (error) {
          console.error(`Error processing file ${srcKey}:`, error);
          throw error; // Re-throw the error to trigger DLQ
        }
      }
    }
  }
};

function createDDbDocClient() {
  const ddbClient = new DynamoDBClient({ region: process.env.REGION });
  const marshallOptions = {
    convertEmptyValues: true,
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  };
  const unmarshallOptions = {
    wrapNumbers: false,
  };
  const translateConfig = { marshallOptions, unmarshallOptions };
  return DynamoDBDocumentClient.from(ddbClient, translateConfig);
}
