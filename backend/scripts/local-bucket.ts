#!/usr/bin/env ts-node
/** Creates the local bucket if it is not there yet (safe to repeat). Reads the S3_* settings from the environment. */
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set`);
    process.exit(1);
  }
  return value;
};

async function main(): Promise<void> {
  const client = new S3Client({
    region: need('S3_REGION'),
    endpoint: need('S3_ENDPOINT'),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId: need('S3_ACCESS_KEY_ID'), secretAccessKey: need('S3_SECRET_ACCESS_KEY') },
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: need('S3_BUCKET') }));
    console.log(`bucket ${process.env.S3_BUCKET} created`);
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') console.log(`bucket ${process.env.S3_BUCKET} already exists`);
    else throw error;
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
