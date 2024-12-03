/* eslint-disable import/extensions, import/no-absolute-path */
import { SQSHandler } from "aws-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { Readable } from "stream";  // Required for working with streams
import { promisify } from "util";  // For converting streams to buffers

const s3 = new S3Client({ region: process.env.REGION });
const ddbDocClient = createDDbDocClient();

const validFileExtensions = [".jpeg", ".png"]; // Allowed file types
const tableName = process.env.TABLE_NAME; // DynamoDB table name

if (!tableName) {
  throw new Error("Environment variable TABLE_NAME is not set");
}

// Function to get the content length of the S3 object (handle stream size)
const getStreamLength = (stream: Readable): Promise<number> => {
  const streamToBuffer = promisify(stream.read);
  let bufferLength = 0;
  return new Promise((resolve, reject) => {
    stream.on('data', chunk => {
      bufferLength += chunk.length;
    });
    stream.on('end', () => resolve(bufferLength));
    stream.on('error', reject);
  });
};

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

        const eventType = messageRecord.eventName;

        // Handle object deletion
        if (eventType.includes("ObjectRemoved")) {
          console.log(`Deleting image ${srcKey} from DynamoDB`);
          await deleteImageFromDynamoDB(srcKey);
        }
        // Handle object creation
        else if (eventType.includes("ObjectCreated")) {
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

            // Calculate the file size
            const fileSize = await getStreamLength(origimage.Body as Readable); // Convert stream to buffer and get length

            // Add image metadata to DynamoDB
            await ddbDocClient.send(
              new PutCommand({
                TableName: tableName,
                Item: {
                  "ImageName": srcKey, // Primary key now matches the expected key "ImageName"
                  "metadata": {
                    "fileSize": fileSize,
                    "fileExtension": fileExtension,
                  }
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
  }
};

// Function to delete an image from DynamoDB
const deleteImageFromDynamoDB = async (key: string) => {
  const params = {
    TableName: tableName,
    Key: {
      ImageName: key, // Ensure this matches the DynamoDB table's primary key
    },
  };

  try {
    await ddbDocClient.send(new DeleteCommand(params));
    console.log(`Successfully deleted ${key} from DynamoDB`);
  } catch (error) {
    console.error(`Error deleting ${key} from DynamoDB: `, error);
    throw error; // Rethrow the error to trigger DLQ handling if necessary
  }
};

// Function to create the DynamoDB Document Client
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
