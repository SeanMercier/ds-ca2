import { SNSHandler } from "aws-lambda";
import { DynamoDBClient, UpdateItemCommand, UpdateItemCommandOutput } from "@aws-sdk/client-dynamodb";

const dynamodbClient = new DynamoDBClient();

const IMAGE_TABLE_NAME = process.env.IMAGE_TABLE_NAME;

export const handler: SNSHandler = async (event) => {
  for (const record of event.Records) {
    const message = JSON.parse(record.Sns.Message);
    const metadataType = record.Sns.MessageAttributes.metadata_type.Value;

    // Define placeholders for reserved keywords
    const expressionAttributeNames: { [key: string]: string } = {};
    const updateExpressionParts: string[] = [];

    // Add the appropriate expression based on the metadata type
    if (metadataType === "Date") {
      expressionAttributeNames["#date"] = "Date"; // Use #date as a placeholder for "Date"
      updateExpressionParts.push("set #date = :value");
    } else if (metadataType === "Caption") {
      expressionAttributeNames["#caption"] = "Caption"; // Use #caption as a placeholder for "Caption"
      updateExpressionParts.push("set #caption = :value");
    } else if (metadataType === "Photographer") {
      expressionAttributeNames["#photographer"] = "Photographer"; // Use #photographer as a placeholder for "Photographer"
      updateExpressionParts.push("set #photographer = :value");
    }

    const updateParams = {
      TableName: IMAGE_TABLE_NAME,
      Key: {
        ImageName: { S: message.id },
      },
      UpdateExpression: updateExpressionParts.join(", "), // Combine all parts of the expression
      ConditionExpression: "attribute_exists(ImageName)", // Only update if the item exists
      ExpressionAttributeValues: {
        ":value": { S: message.value }, // Set the new value for the metadata field
      },
      ExpressionAttributeNames: expressionAttributeNames, // Use the alias for reserved words
    };

    try {
      const result: UpdateItemCommandOutput = await dynamodbClient.send(new UpdateItemCommand(updateParams));
      console.log(`Successfully updated item with id ${message.id}:`, result);
    } catch (error) {
      console.error(`Failed to update item with id ${message.id}:`, error);
    }
  }
};
