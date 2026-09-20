-- AlterTable
ALTER TABLE "CommercialProfile" ADD COLUMN "lukuMeter" TEXT;

-- CreateTable
CREATE TABLE "Luku" (
    "id" TEXT NOT NULL,
    "meterNumber" TEXT NOT NULL,
    "phone" TEXT,
    "ownerName" TEXT,
    "wardKata" TEXT,
    "streetMtaa" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Luku_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Luku_meterNumber_key" ON "Luku"("meterNumber");

-- CreateIndex
CREATE INDEX "Luku_phone_idx" ON "Luku"("phone");
