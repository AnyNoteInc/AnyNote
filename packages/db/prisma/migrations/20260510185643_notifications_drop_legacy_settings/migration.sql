/*
  Warnings:

  - You are about to drop the column `notification_settings` on the `user_preferences` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "user_preferences" DROP COLUMN "notification_settings";
