import { SNSHandler } from "aws-lambda";
import { DynamoDBClient, UpdateItemCommand, UpdateItemCommandOutput } from "@aws-sdk/client-dynamodb";

const dynamodbClient = new DynamoDBClient();

const IMAGE_TABLE_NAME = process.env.IMAGE_TABLE_NAME;

export const handler: SNSHandler = async (event) => {
    for (const record of event.Records) {
        const message = JSON.parse(record.Sns.Message);
        const metadataType = record.Sns.MessageAttributes.metadata_type.Value;

        const updateParams = {
            TableName: IMAGE_TABLE_NAME,
            Key: {
                ImageName: { S: message.id }
            },
            UpdateExpression: `set ${metadataType} = :value`,
            ConditionExpression: 'attribute_exists(ImageName)',
            ExpressionAttributeValues: {
                ':value': { S: message.value }
            }
        };

        try {
            const result: UpdateItemCommandOutput = await dynamodbClient.send(new UpdateItemCommand(updateParams));
            console.log(`Successfully updated item with id ${message.id}:`, result);
        } catch (error) {
            console.error(`Failed to update item with id ${message.id}:`, error);
        }
    }
}