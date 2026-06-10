-- AlterEnum
ALTER TYPE "ExportJobFormat" ADD VALUE 'PDF_ZIP';

-- AlterEnum
ALTER TYPE "ImportJobFormat" ADD VALUE 'CSV';

-- AlterTable
ALTER TABLE "export_jobs" ADD COLUMN     "result" JSONB;
