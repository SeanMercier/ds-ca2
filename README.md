# Assignment 2 (EDA app) - Distributed Systems.

**Name:** Sean Mercier

**YouTube Demo link** - (https://youtu.be/Xjs5tdW0NzA)


## Phase 1.

- **Process Image** - Fully implemented. This Lambda function processes images uploaded to S3, extracts metadata, and stores it in DynamoDB.
- **Mailer Function** - Fully implemented. This function sends confirmation emails after an image is successfully processed.
- **Rejection Mailer** - Fully implemented. This function sends rejection emails if an image fails to process.

## Phase 2.

- **Process Image** - Fully implemented. The Lambda function properly processes images uploaded to S3, updates DynamoDB with metadata, and handles both creation and deletion events.
- **Update Table** - Fully implemented. This function updates metadata attributes for images in the DynamoDB table based on the SNS message, such as caption, date, and photographer.
- **Mailer Function** - Fully implemented. The function sends confirmation emails based on successful image processing.
- **Rejection Mailer** - Fully implemented. The Lambda function sends rejection emails if an image fails processing.

## Phase 3.

- **Process Image** - Fully implemented. The function correctly processes image uploads, including extraction of metadata, and updates DynamoDB.
- **Update Table** - Fully implemented. This function handles metadata updates for images like captions, dates, and photographers based on SNS messages.
- **Log Image** - Fully implemented. This Lambda function logs image metadata to DynamoDB.
- **SNS Integration** - Fully implemented. The integration ensures that metadata is updated and stored correctly in DynamoDB after receiving the relevant SNS messages.


## How to get started

1. **Clone this repository** and add `env.ts` to the base file:

   ```typescript
   export const SES_REGION = 'eu-west-1';
   export const SES_EMAIL_FROM = 'verified-identity-1';
   export const SES_EMAIL_TO = 'verified-identity-2';


2. **Run** 

```typescript
cdk deploy
```

2. **To upload a picture from your local directory, use the following command:** 
```typescript
aws s3 cp ./images/sunflower.jpeg s3://your_bucket_name/sunflower.jpeg
```

3. **To upload an invalid file type to test rejection mailer functionality, use the following command:** 
```typescript
aws s3 cp ./images/rejectiontest.txt s3://your_bucket_name/rejectiontest.txt
```
 
4. **To add metadata to an image, use the following command:** 
```typescript
aws sns publish --topic-arn "your_ARN_value" --message-attributes file://texts/attributes.json --message file://texts/message.json
```

5. **To delete an image from the bucket, use the following command:** 
```typescript
aws s3api delete-object --bucket your_bucket_name --key object-key
```
