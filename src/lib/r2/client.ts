// Phase 2 - Cloudflare R2 client
// =============================================================================
// Stores Pro user gallery images. Egress is free in R2, which is why this is
// preferred over Firebase Storage.
//
// To activate Phase 2:
//   1. Create an R2 bucket at https://dash.cloudflare.com/?to=/:account/r2
//   2. Generate API credentials (Access Key + Secret) with Object Read+Write
//   3. Set the env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//      R2_BUCKET_NAME, R2_PUBLIC_URL
//   4. Install: `npm install @aws-sdk/client-s3` (R2 is S3-compatible)
//   5. Implement the functions below
// =============================================================================

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
}

export function getR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !publicUrl) {
    return null;
  }
  return { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl };
}

export interface UploadImageInput {
  uid: string;
  data: string; // base64
  mimeType: string;
}

export interface UploadImageResult {
  publicUrl: string;
  key: string;
}

// TODO[Phase 2]: implement using @aws-sdk/client-s3 PutObjectCommand
export async function uploadGalleryImage(_input: UploadImageInput): Promise<UploadImageResult> {
  throw new Error("R2 not implemented yet (Phase 2).");
}
