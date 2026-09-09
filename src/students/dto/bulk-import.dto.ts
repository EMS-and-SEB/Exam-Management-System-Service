// This is just for type safety; file upload is handled by multer.
export interface BulkImportFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}
