-- AlterEnum
ALTER TYPE "TaskActivityType" ADD VALUE 'ACTUAL_DATE_CHANGED';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "actual_date" TIMESTAMP(3);
