/* eslint-disable no-console */
import * as fs from "fs";
import type { LinearClient } from "@linear/sdk";

/**
 * Uploads a file to Linear's private cloud storage and returns the asset URL.
 *
 * @param client - Linear client instance
 * @param filePath - Path to the file on the local filesystem
 * @param fileName - Name to use for the uploaded file
 * @returns The URL of the uploaded file in Linear's storage
 * @throws Error if upload fails
 */
export async function uploadFileToLinear(client: LinearClient, filePath: string, fileName: string): Promise<string> {
  // Read file from disk
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const fileSize = fileBuffer.length;

  // Detect content type based on file extension
  const contentType = getContentType(fileName);

  // Request upload URL from Linear
  const uploadPayload = await client.fileUpload(contentType, fileName, fileSize);

  if (!uploadPayload.success || !uploadPayload.uploadFile) {
    throw new Error(`Failed to request upload URL for ${fileName}`);
  }

  const uploadUrl = uploadPayload.uploadFile.uploadUrl;
  const assetUrl = uploadPayload.uploadFile.assetUrl;

  // Prepare headers for PUT request
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=31536000");

  // Copy additional headers from the upload payload
  uploadPayload.uploadFile.headers.forEach(({ key, value }) => {
    headers.set(key, value);
  });

  try {
    // Upload file to Linear's storage
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers,
      body: fileBuffer,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload ${fileName}: ${response.status} ${response.statusText}`);
    }

    return assetUrl;
  } catch (error) {
    console.error(`Error uploading file ${fileName}:`, error);
    throw new Error(`Failed to upload file ${fileName} to Linear`);
  }
}

/**
 * Determines the MIME type based on file extension
 */
function getContentType(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop();

  const mimeTypes: Record<string, string> = {
    // Images
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",

    // Documents
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",

    // Archives
    zip: "application/zip",
    tar: "application/x-tar",
    gz: "application/gzip",
    rar: "application/x-rar-compressed",
    "7z": "application/x-7z-compressed",

    // Text
    txt: "text/plain",
    json: "application/json",
    xml: "application/xml",
    csv: "text/csv",

    // Code
    js: "text/javascript",
    ts: "text/typescript",
    jsx: "text/jsx",
    tsx: "text/tsx",
    html: "text/html",
    css: "text/css",

    // Video
    mp4: "video/mp4",
    mov: "video/quicktime",
    avi: "video/x-msvideo",

    // Audio
    mp3: "audio/mpeg",
    wav: "audio/wav",
  };

  return mimeTypes[ext || ""] || "application/octet-stream";
}
