ALTER TABLE "StudentDirectory"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "StudentDirectory_email_key" ON "StudentDirectory"("email");

CREATE TABLE "StudentActivationInvitation" (
  "id" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StudentActivationInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentActivationInvitation_tokenHash_key"
  ON "StudentActivationInvitation"("tokenHash");
CREATE INDEX "StudentActivationInvitation_studentId_consumedAt_idx"
  ON "StudentActivationInvitation"("studentId", "consumedAt");
CREATE INDEX "StudentActivationInvitation_expiresAt_idx"
  ON "StudentActivationInvitation"("expiresAt");

ALTER TABLE "StudentActivationInvitation"
  ADD CONSTRAINT "StudentActivationInvitation_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "StudentDirectory"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudentPasswordReset" (
  "id" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "resetTokenHash" TEXT,
  "resetTokenExpiresAt" TIMESTAMP(3),
  "resetTokenConsumedAt" TIMESTAMP(3),

  CONSTRAINT "StudentPasswordReset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudentPasswordReset_studentId_idx" ON "StudentPasswordReset"("studentId");

ALTER TABLE "StudentPasswordReset"
  ADD CONSTRAINT "StudentPasswordReset_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "StudentDirectory"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudentRefreshToken" (
  "id" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StudentRefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentRefreshToken_tokenHash_key" ON "StudentRefreshToken"("tokenHash");
CREATE INDEX "StudentRefreshToken_studentId_revokedAt_idx"
  ON "StudentRefreshToken"("studentId", "revokedAt");

ALTER TABLE "StudentRefreshToken"
  ADD CONSTRAINT "StudentRefreshToken_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "StudentDirectory"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
