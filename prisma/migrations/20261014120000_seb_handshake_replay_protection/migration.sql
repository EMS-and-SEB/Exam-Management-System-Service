CREATE TABLE "SebHandshakeToken" (
  "id" UUID NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SebHandshakeToken_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SebHandshakeToken_expiresAt_idx" ON "SebHandshakeToken"("expiresAt");
