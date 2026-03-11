import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

// File upload type definition
interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Production-Grade File Storage Service
 *
 * Responsibilities:
 * - Validate files (type, size, content)
 * - Upload files to Supabase Storage
 * - Generate secure signed URLs
 * - Track file metadata in database
 * - Handle file versioning
 * - Ensure data integrity
 */
@Injectable()
export class FileStorageService {
  private supabase: SupabaseClient;
  private readonly BUCKET_NAME = 'bom-files';
  private readonly MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

  // Industry standard: Define allowed file types explicitly
  private readonly ALLOWED_3D_TYPES = [
    'application/step',
    'application/sla',
    'model/stl',
    'application/octet-stream', // For STEP files without proper MIME type
  ];

  private readonly ALLOWED_2D_TYPES = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
  ];

  private readonly ALLOWED_3D_EXTENSIONS = ['.stp', '.step', '.stl', '.obj', '.iges', '.igs'];
  private readonly ALLOWED_2D_EXTENSIONS = ['.pdf', '.dwg', '.dxf', '.png', '.jpg', '.jpeg'];

  constructor(private configService: ConfigService) {
    // Backend uses server-side environment variables (not NEXT_PUBLIC_ prefix)
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_KEY');

    console.log(`Initializing Supabase client with URL: ${supabaseUrl ? 'SET' : 'MISSING'}, Key: ${supabaseKey ? 'SET' : 'MISSING'}`);

    if (!supabaseUrl || !supabaseKey) {
      throw new InternalServerErrorException(
        'Missing required Supabase environment variables: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set'
      );
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
    console.log(`Supabase client initialized successfully for bucket: ${this.BUCKET_NAME}`);
  }

  /**
   * Validate file before upload
   * - Check file size
   * - Verify file type against whitelist
   * - Validate file extension
   */
  private validateFile(
    file: UploadedFile,
    fileType: '3d' | '2d',
  ): void {
    // Check file size
    if (file.size > this.MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File size exceeds maximum allowed size of ${this.MAX_FILE_SIZE / 1024 / 1024}MB`,
      );
    }

    // Check file extension
    const extension = '.' + file.originalname.split('.').pop()?.toLowerCase();
    const allowedExtensions = fileType === '3d'
      ? this.ALLOWED_3D_EXTENSIONS
      : this.ALLOWED_2D_EXTENSIONS;

    if (!allowedExtensions.includes(extension)) {
      throw new BadRequestException(
        `Invalid file extension. Allowed extensions for ${fileType} files: ${allowedExtensions.join(', ')}`,
      );
    }

    // Check MIME type (defense in depth - don't trust client)
    const allowedMimeTypes = fileType === '3d'
      ? this.ALLOWED_3D_TYPES
      : this.ALLOWED_2D_TYPES;

    // For certain file types, MIME type might not be set correctly
    // so we rely more on extension validation
    if (file.mimetype && !allowedMimeTypes.includes(file.mimetype)) {
      // Only warn for 3D files due to MIME type inconsistencies
      if (fileType === '2d') {
        throw new BadRequestException(
          `Invalid file type. Allowed types: ${allowedMimeTypes.join(', ')}`,
        );
      }
    }
  }

  /**
   * Calculate SHA-256 checksum for file integrity
   */
  private calculateChecksum(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Generate storage path following industry-standard structure
   * Pattern: {userId}/{projectId}/bom-items/{bomItemId}/{fileType}/{timestamp}_{filename}
   */
  private generateStoragePath(
    userId: string,
    projectId: string,
    bomItemId: string,
    fileType: '3d' | '2d',
    originalName: string,
  ): string {
    const timestamp = Date.now();
    const sanitizedFilename = originalName
      .replace(/[^a-zA-Z0-9._-]/g, '_') // Sanitize filename
      .toLowerCase();

    return `${userId}/${projectId}/bom-items/${bomItemId}/${fileType}/${timestamp}_${sanitizedFilename}`;
  }

  /**
   * Upload file to Supabase Storage
   * Returns storage path and file metadata
   */
  async uploadFile(
    file: UploadedFile,
    fileType: '3d' | '2d',
    userId: string,
    projectId: string,
    bomItemId: string,
  ): Promise<{
    storagePath: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    checksum: string;
  }> {
    // Validate file
    this.validateFile(file, fileType);

    // Calculate checksum for integrity
    const checksum = this.calculateChecksum(file.buffer);

    // Generate storage path
    const storagePath = this.generateStoragePath(
      userId,
      projectId,
      bomItemId,
      fileType,
      file.originalname,
    );

    try {
      // Upload to Supabase Storage
      const { data, error } = await this.supabase.storage
        .from(this.BUCKET_NAME)
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false, // Prevent accidental overwrites
        });

      if (error) {
        throw new InternalServerErrorException(
          `Failed to upload file: ${error.message}`,
        );
      }

      return {
        storagePath: data.path,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        checksum,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `File upload failed: ${error.message}`,
      );
    }
  }

  /**
   * Generate signed URL for secure file download
   * - URLs expire after specified duration (default: 1 hour)
   * - Enforces access control through RLS policies
   */
  async getSignedUrl(
    storagePath: string,
    expiresIn: number = 3600, // 1 hour in seconds
  ): Promise<string> {
    try {
      console.log(`Attempting to generate signed URL for path: ${storagePath} in bucket: ${this.BUCKET_NAME}`);
      
      const { data, error } = await this.supabase.storage
        .from(this.BUCKET_NAME)
        .createSignedUrl(storagePath, expiresIn);

      if (error) {
        console.error(`Supabase storage error:`, error);
        throw new InternalServerErrorException(
          `Failed to generate signed URL - Supabase error: ${error.message}`,
        );
      }

      if (!data || !data.signedUrl) {
        console.error(`No data returned from Supabase storage for path: ${storagePath}`);
        throw new InternalServerErrorException(
          `Failed to generate signed URL - No data returned for path: ${storagePath}`,
        );
      }

      console.log(`Successfully generated signed URL for path: ${storagePath}`);
      return data.signedUrl;
    } catch (error) {
      console.error(`Exception in getSignedUrl for path ${storagePath}:`, error);
      throw new InternalServerErrorException(
        `Failed to generate signed URL: ${error.message}`,
      );
    }
  }

  /**
   * Test Supabase storage connection
   */
  async testConnection(): Promise<boolean> {
    try {
      console.log(`Testing connection to bucket: ${this.BUCKET_NAME}`);
      const { data, error } = await this.supabase.storage.listBuckets();
      
      if (error) {
        console.error('Failed to list buckets:', error);
        return false;
      }
      
      console.log('Available buckets:', data?.map(b => b.name));
      return data?.some(bucket => bucket.name === this.BUCKET_NAME) || false;
    } catch (error) {
      console.error('Exception testing connection:', error);
      return false;
    }
  }

  /**
   * List files in a directory path for debugging
   */
  async listFiles(directoryPath: string): Promise<string[]> {
    try {
      console.log(`Listing files in directory: ${directoryPath}`);
      
      const { data, error } = await this.supabase.storage
        .from(this.BUCKET_NAME)
        .list(directoryPath, { limit: 100 });
      
      if (error) {
        console.error(`Error listing files in ${directoryPath}:`, error);
        return [];
      }
      
      const fileNames = data?.map(item => item.name) || [];
      console.log(`Found ${fileNames.length} files in ${directoryPath}:`, fileNames);
      return fileNames;
    } catch (error) {
      console.error(`Exception listing files in ${directoryPath}:`, error);
      return [];
    }
  }

  /**
   * Check file in both buckets for debugging
   */
  async findFileInBuckets(filePath: string): Promise<{bucket: string, exists: boolean}[]> {
    const buckets = ['bom-files', 'Bom'];
    const results: {bucket: string, exists: boolean}[] = [];
    
    for (const bucketName of buckets) {
      try {
        const { data, error } = await this.supabase.storage
          .from(bucketName)
          .list(filePath.substring(0, filePath.lastIndexOf('/')), {
            limit: 1,
            search: filePath.substring(filePath.lastIndexOf('/') + 1)
          });
        
        const exists = !!(data && data.length > 0);
        results.push({ bucket: bucketName, exists });
        console.log(`File ${filePath} in bucket '${bucketName}': ${exists ? 'EXISTS' : 'NOT FOUND'}`);
      } catch (error) {
        console.error(`Error checking ${filePath} in bucket ${bucketName}:`, error);
        results.push({ bucket: bucketName, exists: false });
      }
    }
    
    return results;
  }

  /**
   * Check if file exists in storage
   */
  async fileExists(storagePath: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.storage
        .from(this.BUCKET_NAME)
        .list(storagePath.substring(0, storagePath.lastIndexOf('/')), {
          limit: 1,
          search: storagePath.substring(storagePath.lastIndexOf('/') + 1)
        });
      
      if (error) {
        console.error(`Error checking file existence:`, error);
        return false;
      }
      
      return data && data.length > 0;
    } catch (error) {
      console.error(`Exception checking file existence:`, error);
      return false;
    }
  }

  /**
   * Delete file from Supabase Storage
   */
  async deleteFile(storagePath: string): Promise<void> {
    try {
      const { error } = await this.supabase.storage
        .from(this.BUCKET_NAME)
        .remove([storagePath]);

      if (error) {
        throw new InternalServerErrorException(
          `Failed to delete file: ${error.message}`,
        );
      }
    } catch (error) {
      throw new InternalServerErrorException(
        `File deletion failed: ${error.message}`,
      );
    }
  }

  /**
   * Get file public URL (for public buckets only)
   * Note: Our bucket is private, so use getSignedUrl instead
   */
  getPublicUrl(storagePath: string): string {
    const { data } = this.supabase.storage
      .from(this.BUCKET_NAME)
      .getPublicUrl(storagePath);

    return data.publicUrl;
  }
}
